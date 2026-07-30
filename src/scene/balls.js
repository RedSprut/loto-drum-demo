/**
 * The physical lottery balls for the CURRENT pool. Each is an independent Rapier
 * rigid body (a perfect sphere) paired with a PBR sphere mesh synced from physics
 * every frame. Balls never sleep while a draw is running, so the rotor always has
 * a live bed to stir. The set is data-driven: `loadPool()` builds the right count,
 * range and colour for whatever pool the game profile asks for.
 */
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { ballTexture } from '../util/numbers.js';
import { secureRandom } from '../util/prng.js';

// Local surface direction of the equator medallion at u=0.625 on a
// THREE.SphereGeometry (mapping: at v=0.5, dir = (-cos(u·2π), 0, sin(u·2π))).
const MEDALLION_DIR = new THREE.Vector3(-Math.cos(0.625 * Math.PI * 2), 0, Math.sin(0.625 * Math.PI * 2)).normalize();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** Per-ball motion history, so we can guarantee every ball keeps moving. */
class BallMotionTracker {
  constructor(body) {
    const t = body.translation();
    this.lx = t.x; this.ly = t.y; this.lz = t.z;
    this.still = 0; this.top = 0; this.bottom = 0; this.wall = 0;
    this.linSpeed = 0; this.angSpeed = 0;
  }

  update(body, dt, R, br) {
    const p = body.translation(), v = body.linvel(), w = body.angvel();
    const moved = Math.hypot(p.x - this.lx, p.y - this.ly, p.z - this.lz);
    this.linSpeed = Math.hypot(v.x, v.y, v.z);
    this.angSpeed = Math.hypot(w.x, w.y, w.z);
    this.still = (moved < br * 0.03 && this.linSpeed < 0.15 && this.angSpeed < 0.2) ? this.still + dt : 0;
    this.top = p.y > R * 0.45 ? this.top + dt : 0;
    this.bottom = p.y < -R * 0.55 ? this.bottom + dt : 0;
    this.wall = Math.hypot(p.x, p.y, p.z) > R * 0.88 ? this.wall + dt : 0;
    this.lx = p.x; this.ly = p.y; this.lz = p.z;
  }
}

function colorFor(value, colorSet) {
  const set = CONFIG.ball.colorSets[colorSet] || CONFIG.ball.colorSets.multicolor;
  // Group by tens so each number range shares a colour (like real lottery balls).
  return set[Math.floor((value - 1) / 10) % set.length];
}

export class Balls {
  constructor(scene, physics, segs = CONFIG.ball.segments) {
    this.scene = scene;
    this.physics = physics;
    this.items = [];   // {value, poolId, lifecycle, body, collider, mesh, drawn, parked, settledTime}
    this.poolInfo = new Map();     // poolId -> {initial, min, max}
    this.removedByPool = new Map(); // poolId -> count disposed after its pool finished
    this.geo = new THREE.SphereGeometry(CONFIG.ball.radius, segs[0], segs[1]);
  }

  /** Numbers to load for a pool: EXACTLY the official range min..max (no caps,
   *  no spares, no duplicates). */
  _numbersFor(pool) {
    const all = [];
    for (let n = pool.min; n <= pool.max; n++) all.push(n);
    return all;
  }

  /** Non-overlapping start positions in the lower/central region of the sphere. */
  _layout(count) {
    const R = CONFIG.drum.radius;
    const br = CONFIG.ball.radius;
    const out = [];
    let attempts = 0;
    const max = count * 400;
    while (out.length < count && attempts < max) {
      attempts++;
      const x = (secureRandom() * 2 - 1) * R * 0.78;
      const y = -R * 0.82 + secureRandom() * R * 0.7;
      const z = (secureRandom() * 2 - 1) * R * 0.6;
      if (Math.hypot(x, y, z) > R - br * 2.4) continue;
      if (Math.hypot(y, z) < CONFIG.rotor.hubRadius + br * 1.4 && Math.abs(x) < R * 0.6) continue;
      let ok = true;
      for (const p of out) {
        const dx = p.x - x, dy = p.y - y, dz = p.z - z;
        if (dx * dx + dy * dy + dz * dz < (br * 2.2) ** 2) { ok = false; break; }
      }
      if (ok) out.push({ x, y, z });
    }
    while (out.length < count) out.push({ x: (secureRandom() * 2 - 1) * R * 0.5, y: -R * 0.4, z: (secureRandom() * 2 - 1) * R * 0.4 });
    return out;
  }

  /** (Re)load the balls for `pool`, removing any balls still in the drum. Creates
   *  EXACTLY one physical ball per number in the official range. */
  loadPool(pool) {
    this.removeInDrum();
    const numbers = this._numbersFor(pool);
    this.poolInfo.set(pool.id, { initial: numbers.length, min: pool.min, max: pool.max });
    if (!this.removedByPool.has(pool.id)) this.removedByPool.set(pool.id, 0);
    const home = this._layout(numbers.length);
    numbers.forEach((value, i) => {
      const color = colorFor(value, pool.colorSet);
      const mat = new THREE.MeshPhysicalMaterial({
        map: ballTexture(value, color), color: 0xffffff,
        metalness: 0.02, roughness: 0.2, clearcoat: 1.0, clearcoatRoughness: 0.08, envMapIntensity: 1.0,
      });
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.scene.add(mesh);
      const p = home[i];
      const { body, collider } = this.physics.addBall(p.x, p.y, p.z);
      this._kick(body);
      this.items.push({ value, poolId: pool.id, colorSet: pool.colorSet, body, collider, mesh, drawn: false, parked: false, lifecycle: 'inside-drum', settledTime: 0, tracker: new BallMotionTracker(body) });
    });
    this._assertUnique(pool.id);
    this.assertConservation();
  }

  _kick(body) {
    const s = () => (secureRandom() * 2 - 1);
    body.setLinvel({ x: s() * 0.5, y: s() * 0.5, z: s() * 0.5 }, true);
    body.setAngvel({ x: s() * 3, y: s() * 3, z: s() * 3 }, true);
    body.wakeUp();
  }

  /** Dispose every ball still in the drum (keeps parked winners in the rack).
   *  Each disposed ball is counted as removed-after-pool so conservation holds. */
  removeInDrum() {
    const keep = [];
    for (const it of this.items) {
      if (it.parked) { keep.push(it); continue; }
      this.removedByPool.set(it.poolId, (this.removedByPool.get(it.poolId) || 0) + 1);
      it.lifecycle = 'removed-after-pool';
      this.scene.remove(it.mesh);
      it.mesh.material.dispose();
      this.physics.removeBody(it.body);
    }
    this.items = keep;
  }

  /** Dispose EVERYTHING (in-drum and parked) — full reset of all ledgers. */
  removeAll() {
    for (const it of this.items) {
      this.scene.remove(it.mesh);
      it.mesh.material.dispose();
      this.physics.removeBody(it.body);
    }
    this.items = [];
    this.poolInfo.clear();
    this.removedByPool.clear();
  }

  // ── Conservation / uniqueness invariants ──────────────────────────────────

  /** Per-pool counts by lifecycle (physical pool = the pool a ball was made in). */
  poolCounts(poolId) {
    const info = this.poolInfo.get(poolId) || { initial: 0 };
    let inside = 0, transit = 0, rack = 0;
    for (const it of this.items) {
      if (it.poolId !== poolId) continue;
      if (it.parked) rack++;
      else if (it.drawn) transit++;
      else inside++;
    }
    const removed = this.removedByPool.get(poolId) || 0;
    const total = inside + transit + rack + removed;
    return { poolId, initial: info.initial, inside, transit, rack, removed, total, valid: total === info.initial };
  }

  allPoolCounts() { return [...this.poolInfo.keys()].map((id) => this.poolCounts(id)); }

  /** Throw if any pool's ball count doesn't balance to its official initial. */
  assertConservation() {
    for (const c of this.allPoolCounts()) {
      if (!c.valid) {
        throw new Error(`Ball conservation failed for ${c.poolId}: initial=${c.initial}, inside=${c.inside}, transit=${c.transit}, rack=${c.rack}, removed=${c.removed}, total=${c.total}`);
      }
    }
  }

  /** Throw if a freshly loaded pool isn't exactly the unique set min..max. */
  _assertUnique(poolId) {
    const info = this.poolInfo.get(poolId);
    const nums = this.items.filter((it) => it.poolId === poolId).map((it) => it.value);
    const uniq = new Set(nums);
    if (uniq.size !== nums.length) throw new Error(`Duplicate ball numbers in pool ${poolId}`);
    const expected = info.max - info.min + 1;
    if (nums.length !== expected) throw new Error(`Pool ${poolId} has ${nums.length} balls, expected ${expected}`);
    for (let n = info.min; n <= info.max; n++) if (!uniq.has(n)) throw new Error(`Pool ${poolId} missing number ${n}`);
  }

  /** {unique, duplicates, missing} for a pool's currently-loaded physical set. */
  uniquenessReport(poolId) {
    const info = this.poolInfo.get(poolId) || { min: 1, max: 0 };
    const nums = this.items.filter((it) => it.poolId === poolId).map((it) => it.value);
    const uniq = new Set(nums);
    let missing = 0;
    for (let n = info.min; n <= info.max; n++) if (!uniq.has(n)) missing++;
    return { unique: uniq.size, duplicates: nums.length - uniq.size, missing };
  }

  /** Wake all in-play balls (called during MIXING so nothing dozes off). */
  keepAwake() {
    for (const it of this.items) if (!it.parked && it.body.isSleeping()) it.body.wakeUp();
  }

  /** In-play items (not drawn, not parked). */
  activeItems() {
    const out = [];
    for (const it of this.items) if (!it.drawn && !it.parked) out.push(it);
    return out;
  }

  /** Advance every active ball's motion tracker. */
  updateTrackers(dt) {
    const R = CONFIG.drum.radius, br = CONFIG.ball.radius;
    for (const it of this.items) if (!it.drawn && !it.parked) it.tracker.update(it.body, dt, R, br);
  }

  /** Worst-case stuck timers + ratios across active balls (for diagnostics). */
  stuckStats() {
    const arr = this.activeItems();
    const n = arr.length || 1;
    let sMax = 0, tMax = 0, bMax = 0, wMax = 0, sN = 0, tN = 0, bN = 0, wN = 0;
    for (const it of arr) {
      const k = it.tracker;
      sMax = Math.max(sMax, k.still); tMax = Math.max(tMax, k.top); bMax = Math.max(bMax, k.bottom); wMax = Math.max(wMax, k.wall);
      if (k.still > 0.8) sN++; if (k.top > 0.8) tN++; if (k.bottom > 0.8) bN++; if (k.wall > 1.0) wN++;
    }
    return { count: arr.length, stillMax: sMax, topMax: tMax, bottomMax: bMax, wallMax: wMax,
      stillN: sN, topN: tN, bottomN: bN, wallN: wN,
      stillRatio: sN / n, topRatio: tN / n, bottomRatio: bN / n, wallRatio: wN / n };
  }

  /** Fraction of in-play balls that are meaningfully moving. */
  activity() {
    let moving = 0, total = 0;
    for (const it of this.items) {
      if (it.parked || it.drawn) continue;
      total++;
      const v = it.body.linvel();
      if (v.x * v.x + v.y * v.y + v.z * v.z > 0.16) moving++;
    }
    return total ? moving / total : 0;
  }

  /** Rich 3D-mixing metrics for diagnostics (see §11 of the brief). */
  metrics() {
    const R = CONFIG.drum.radius;
    const arr = this.items.filter((it) => !it.parked && !it.drawn);
    const n = arr.length || 1;
    let moving = 0, linSum = 0, angSum = 0, near = 0, top = 0, bot = 0;
    let mx = 0, my = 0, mz = 0, vx = 0, vy = 0, vz = 0;
    const ps = [];
    for (const it of arr) {
      const p = it.body.translation(), v = it.body.linvel(), w = it.body.angvel();
      const sp = Math.hypot(v.x, v.y, v.z);
      if (sp > 0.4) moving++;
      linSum += sp; angSum += Math.hypot(w.x, w.y, w.z);
      mx += p.x; my += p.y; mz += p.z; vx += v.x; vy += v.y; vz += v.z;
      ps.push(p);
      if (Math.hypot(p.x, p.y, p.z) > R * 0.85) near++;
      if (p.y > R * 0.4) top++; if (p.y < -R * 0.4) bot++;
    }
    mx /= n; my /= n; mz /= n;
    let sx = 0, sy = 0, sz = 0;
    for (const p of ps) { sx += (p.x - mx) ** 2; sy += (p.y - my) ** 2; sz += (p.z - mz) ** 2; }
    const avgLin = linSum / n;
    const coherent = avgLin > 1e-3 ? Math.hypot(vx / n, vy / n, vz / n) / avgLin : 0;
    return {
      count: arr.length, movingRatio: moving / n, avgLinSpeed: avgLin, avgAngSpeed: angSum / n,
      varX: sx / n, varY: sy / n, varZ: sz / n,
      nearWallRatio: near / n, topRatio: top / n, bottomRatio: bot / n, coherent,
    };
  }

  /** Clear accumulated forces/torques so only the CURRENT frame's forces apply
   *  (Rapier keeps addForce persistent until reset — otherwise stale mixing forces
   *  would keep pushing balls up after the mixer stops). */
  resetForces() {
    for (const it of this.items) {
      if (it.parked) continue;
      it.body.resetForces?.(false);
      it.body.resetTorques?.(false);
    }
  }

  /** Keep ball speeds sane so nothing tunnels the wall. */
  clampSpeeds() {
    const { maxLinSpeed, maxAngSpeed } = CONFIG.ball;
    for (const it of this.items) {
      if (it.parked) continue;
      const v = it.body.linvel(); const s = Math.hypot(v.x, v.y, v.z);
      if (s > maxLinSpeed) { const k = maxLinSpeed / s; it.body.setLinvel({ x: v.x * k, y: v.y * k, z: v.z * k }, true); }
      const w = it.body.angvel(); const a = Math.hypot(w.x, w.y, w.z);
      if (a > maxAngSpeed) { const k = maxAngSpeed / a; it.body.setAngvel({ x: w.x * k, y: w.y * k, z: w.z * k }, true); }
    }
  }

  // ── Final settling (all artificial forces off; only gravity) ──────────────

  /** Guarantee every remaining in-drum ball is a normal dynamic body under full
   *  gravity with free translation/rotation (no leftover kinematic/frozen state). */
  restoreDynamic() {
    const { RAPIER } = this.physics;
    for (const it of this.items) {
      if (it.parked) continue;
      const b = it.body;
      if (b.bodyType() !== RAPIER.RigidBodyType.Dynamic) b.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      b.setGravityScale?.(1.0, true);
      b.setEnabledTranslations?.(true, true, true, true);
      b.setEnabledRotations?.(true, true, true, true);
      // Make balls behave like heavy sand so they roll down and rest at the
      // bottom instead of bouncing/wedging on the faceted wall. (Still only
      // gravity + friction + damping — no artificial forces.)
      b.setLinearDamping?.(CONFIG.settle.damping);
      b.setAngularDamping?.(CONFIG.settle.damping);
      it.collider?.setRestitution?.(CONFIG.settle.restitution);
      it.collider?.setFriction?.(CONFIG.settle.friction);
      b.wakeUp();
      it.settledTime = 0;
    }
  }

  /** Smooth analytic spherical wall as a penalty force (spring + damping on the
   *  outward velocity). It engages a hair inside the faceted trimesh so balls ride
   *  a perfect sphere and never catch on a facet crease — applied every step, for
   *  mixing and settling alike. Uniform for all balls; it is the drum wall. */
  applyWall() {
    const maxR = CONFIG.drum.radius - CONFIG.ball.radius - CONFIG.wall.margin;
    const throatR = CONFIG.drum.throatRadius + CONFIG.ball.radius * 0.5;
    const throatY = -CONFIG.drum.radius * 0.6;
    const { k, damp } = CONFIG.wall;
    for (const it of this.items) {
      if (it.drawn || it.parked) continue;
      const p = it.body.translation();
      // Leave the bottom-centre throat open so a ball can drop through to capture.
      if (p.y < throatY && Math.hypot(p.x, p.z) < throatR) continue;
      const r = Math.hypot(p.x, p.y, p.z);
      if (r <= maxR || r < 1e-4) continue;
      const nx = p.x / r, ny = p.y / r, nz = p.z / r;
      const v = it.body.linvel();
      const vn = v.x * nx + v.y * ny + v.z * nz;      // outward radial speed
      const f = -(k * (r - maxR) + damp * Math.max(0, vn)); // inward
      it.body.addForce({ x: nx * f, y: ny * f, z: nz * f }, true);
    }
  }

  /** Accumulate per-ball "at rest" time and, once a ball is genuinely settled,
   *  clear its microscopic jitter and let it SLEEP (a truly static final frame). */
  updateSettling(dt) {
    const S = CONFIG.settle;
    for (const it of this.items) {
      if (it.drawn || it.parked) continue;
      if (it.body.isSleeping()) { it.settledTime = S.hold; continue; }
      const v = it.body.linvel(), w = it.body.angvel();
      const lin = Math.hypot(v.x, v.y, v.z), ang = Math.hypot(w.x, w.y, w.z);
      it.settledTime = (lin < S.linThresh && ang < S.angThresh) ? (it.settledTime || 0) + dt : 0;
      // A resting ball (can't hover under gravity) → zero the jitter and sleep.
      if (it.settledTime > 0.8 && lin < 0.05 && ang < 0.08) {
        it.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
        it.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
        it.body.sleep?.();
      }
    }
  }

  /** {allSettled, suspended, maxY} for the remaining in-drum balls. `suspended`
   *  = balls resting above the bottom region (must be 0 in the final frame). */
  settleStatus() {
    const S = CONFIG.settle;
    const suspendY = CONFIG.drum.radius * S.suspendYFrac;
    let all = true, suspended = 0, maxY = -Infinity, n = 0;
    for (const it of this.items) {
      if (it.drawn || it.parked) continue;
      n++;
      const p = it.body.translation();
      maxY = Math.max(maxY, p.y);
      if ((it.settledTime || 0) < S.hold) all = false;
      if (p.y > suspendY) suspended++;
    }
    return { allSettled: n === 0 ? true : all, suspended, maxY: n === 0 ? 0 : maxY, count: n };
  }

  sync() {
    for (const it of this.items) {
      if (it.parked) continue; // parked winners: mesh driven by the facing animation
      const t = it.body.translation();
      const q = it.body.rotation();
      it.mesh.position.set(t.x, t.y, t.z);
      it.mesh.quaternion.set(q.x, q.y, q.z, q.w);
    }
  }

  /** Smoothly turn each parked winner's MESH so its number faces the camera.
   *  The Rapier body is never touched — only the visual mesh rotates. */
  updateFacing(dt, camera) {
    const k = 1 - Math.exp(-dt * 8); // ≈ settles in ~0.4 s
    for (const it of this.items) {
      if (!it.parked) continue;
      _v.copy(camera.position).sub(it.mesh.position).normalize();
      _q.setFromUnitVectors(MEDALLION_DIR, _v);
      it.mesh.quaternion.slerp(_q, k);
    }
  }

  /** Snap all parked winners to face the camera immediately (for stills). */
  snapFacing(camera) {
    for (const it of this.items) if (it.parked) Balls.faceCamera(it.mesh, camera);
  }

  /** In-play balls of the current pool (not yet drawn). */
  active() { return this.items.filter((it) => !it.drawn && !it.parked); }
  inDrumCount() { return this.items.filter((it) => !it.parked).length; }

  /** Rotate a parked winner's mesh so a number medallion faces the camera. */
  static faceCamera(mesh, camera) {
    const toCam = camera.position.clone().sub(mesh.position).normalize();
    mesh.quaternion.setFromUnitVectors(MEDALLION_DIR, toCam);
  }
}
