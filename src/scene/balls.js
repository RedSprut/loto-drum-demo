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

// Local direction of the equator medallion at u=0.625 on a THREE.SphereGeometry.
const MEDALLION_DIR = new THREE.Vector3(Math.cos(0.625 * Math.PI * 2), 0, -Math.sin(0.625 * Math.PI * 2)).normalize();

function colorFor(value, colorSet) {
  const set = CONFIG.ball.colorSets[colorSet] || CONFIG.ball.colorSets.multicolor;
  // Group by tens so each number range shares a colour (like real lottery balls).
  return set[Math.floor((value - 1) / 10) % set.length];
}

export class Balls {
  constructor(scene, physics, segs = CONFIG.ball.segments) {
    this.scene = scene;
    this.physics = physics;
    this.items = [];   // {value, poolId, colorSet, body, collider, mesh, drawn, parked}
    this.geo = new THREE.SphereGeometry(CONFIG.ball.radius, segs[0], segs[1]);
  }

  /** Numbers to load for a pool: full range, or a random subset if capped. */
  _numbersFor(pool) {
    const all = [];
    for (let n = pool.min; n <= pool.max; n++) all.push(n);
    const cap = pool.loadedBallCount;
    if (!cap || cap >= all.length) return all;
    // Random distinct subset (winner is still a physical ball from these).
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(secureRandom() * (i + 1));
      [all[i], all[j]] = [all[j], all[i]];
    }
    return all.slice(0, cap).sort((a, b) => a - b);
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

  /** (Re)load the balls for `pool`, removing any balls still in the drum. */
  loadPool(pool) {
    this.removeInDrum();
    const numbers = this._numbersFor(pool);
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
      this.items.push({ value, poolId: pool.id, colorSet: pool.colorSet, body, collider, mesh, drawn: false, parked: false });
    });
  }

  _kick(body) {
    const s = () => (secureRandom() * 2 - 1);
    body.setLinvel({ x: s() * 0.5, y: s() * 0.5, z: s() * 0.5 }, true);
    body.setAngvel({ x: s() * 3, y: s() * 3, z: s() * 3 }, true);
    body.wakeUp();
  }

  /** Dispose every ball still in the drum (keeps parked winners in the rack). */
  removeInDrum() {
    const keep = [];
    for (const it of this.items) {
      if (it.parked) { keep.push(it); continue; }
      this.scene.remove(it.mesh);
      it.mesh.material.dispose();
      this.physics.removeBody(it.body);
    }
    this.items = keep;
  }

  /** Dispose EVERYTHING (in-drum and parked) — full reset. */
  removeAll() {
    for (const it of this.items) {
      this.scene.remove(it.mesh);
      it.mesh.material.dispose();
      this.physics.removeBody(it.body);
    }
    this.items = [];
  }

  /** Wake all in-play balls (called during MIXING so nothing dozes off). */
  keepAwake() {
    for (const it of this.items) if (!it.parked && it.body.isSleeping()) it.body.wakeUp();
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

  sync() {
    for (const it of this.items) {
      const t = it.body.translation();
      const q = it.body.rotation();
      it.mesh.position.set(t.x, t.y, t.z);
      it.mesh.quaternion.set(q.x, q.y, q.z, q.w);
    }
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
