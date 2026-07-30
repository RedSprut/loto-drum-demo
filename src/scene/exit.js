/**
 * The visible exit path for a drawn ball: a receiving cup under the throat, a
 * transparent lift tube, a front trough (chute), and a data-driven accumulator
 * rack. The rack is a shallow LINEAR GUIDE (not an egg carton): a long dark base
 * with low side rails and small dividers, split into result GROUPS (main | bonus)
 * with a lit separator between them. It is rebuilt per game profile.
 */
import * as THREE from 'three';
import { CONFIG } from '../config.js';

const V = (p) => new THREE.Vector3(p[0], p[1], p[2]);

export class Exit {
  constructor(scene) {
    this.scene = scene;
    this.captureY = -CONFIG.drum.radius - 0.18;
    this.rackGroup = null;
    this.slots = [];          // slots[groupIndex] = [Vector3, …]
    this._materials();
    this._buildPath();
  }

  _materials() {
    const C = CONFIG.colors;
    this.clear = new THREE.MeshPhysicalMaterial({
      color: 0xeaf1fb, metalness: 0, roughness: 0.08, transmission: 0.94, thickness: 0.15,
      ior: 1.45, transparent: true, opacity: 0.4, clearcoat: 1, clearcoatRoughness: 0.05,
      side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.1,
    });
    this.silver = new THREE.MeshStandardMaterial({ color: C.silver, metalness: 0.9, roughness: 0.26, envMapIntensity: 1.1 });
    this.graphite = new THREE.MeshStandardMaterial({ color: C.graphite, metalness: 0.6, roughness: 0.5 });
  }

  _buildPath() {
    const E = CONFIG.exit;
    // Receiving cup.
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(CONFIG.ball.radius * 1.5, CONFIG.ball.radius * 1.0, 0.42, 28, 1, true), this.clear);
    cup.position.set(0, this.captureY + 0.05, 0.2);
    const cupRing = new THREE.Mesh(new THREE.TorusGeometry(CONFIG.ball.radius * 1.5, 0.03, 12, 28), this.silver);
    cupRing.rotation.x = Math.PI / 2; cupRing.position.copy(cup.position); cupRing.position.y += 0.21;
    this.scene.add(cup, cupRing);

    // Lift tube.
    this.tubeCurve = new THREE.CatmullRomCurve3(E.tube.map(V));
    this.scene.add(new THREE.Mesh(new THREE.TubeGeometry(this.tubeCurve, 80, E.tubeRadius, 20, false), this.clear));

    // Front chute (open trough) + metal side rails.
    this.chuteCurve = new THREE.CatmullRomCurve3(E.chute.map(V));
    this.scene.add(new THREE.Mesh(troughGeometry(this.chuteCurve, E.chuteHalfWidth, 0.16), this.clear));
    for (const s of [-1, 1]) {
      this.scene.add(new THREE.Mesh(new THREE.TubeGeometry(offsetCurve(this.chuteCurve, s * (E.chuteHalfWidth + 0.03), 0.16), 40, 0.02, 8, false), this.silver));
    }
  }

  /** Build the accumulator rack from the profile's result groups. */
  buildRack(profile) {
    this.disposeRack();
    const R = CONFIG.exit.rack;
    const C = CONFIG.colors;
    const ballR = CONFIG.ball.radius;
    const step = ballR * 2 + R.ballGap;

    const groups = profile.resultLayout.groups;
    const widths = groups.map((g) => (g.slotCount - 1) * step);
    const between = step + R.groupGap; // last slot of a group → first slot of next
    let total = widths.reduce((a, w) => a + w, 0) + between * (groups.length - 1);
    let cursor = -total / 2;

    this.rackGroup = new THREE.Group();
    this.slots = [];
    const seatY = R.y - ballR - R.slotDepth;

    groups.forEach((g, gi) => {
      const first = cursor;
      const groupSlots = [];
      for (let i = 0; i < g.slotCount; i++) groupSlots.push(new THREE.Vector3(first + i * step, R.y, R.z));
      this.slots.push(groupSlots);

      const gW = widths[gi] + step; // add a ball's worth of margin
      const cx = first + widths[gi] / 2;

      // Group base plate (bonus groups tinted).
      const isBonus = gi > 0;
      const plate = new THREE.Mesh(
        new THREE.BoxGeometry(gW, 0.12, 0.66),
        new THREE.MeshStandardMaterial({ color: isBonus ? 0x241a2e : C.graphite, metalness: 0.5, roughness: 0.5, envMapIntensity: 0.8 }),
      );
      plate.position.set(cx, seatY - 0.04, R.z);
      plate.receiveShadow = true;
      // Low side rails (front + back) — the linear guide.
      for (const s of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(gW, 0.05, 0.03), this.silver);
        rail.position.set(cx, R.y - ballR + 0.02, R.z + s * 0.31);
        this.rackGroup.add(rail);
      }
      // Small dividers between seats.
      for (let i = 0; i <= g.slotCount; i++) {
        const x = first - step / 2 + i * step;
        const div = new THREE.Mesh(new THREE.BoxGeometry(0.03, R.sepHeight, 0.5), this.silver);
        div.position.set(x, R.y - ballR + R.sepHeight / 2, R.z);
        this.rackGroup.add(div);
      }
      // Dim underglow (gold for main, colour-matched for bonus).
      const glowColor = isBonus ? (CONFIG.ball.colorSets[profile.bonusPools[gi - 1]?.colorSet]?.[0] ?? C.gold) : C.gold;
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(gW * 0.94, 0.02, 0.05),
        new THREE.MeshStandardMaterial({ color: glowColor, emissive: glowColor, emissiveIntensity: 0.32, metalness: 0.3, roughness: 0.5 }),
      );
      strip.position.set(cx, seatY - 0.1, R.z + 0.34);
      this.rackGroup.add(plate, strip);

      cursor += widths[gi] + between;

      // Lit separator between groups.
      if (gi < groups.length - 1) {
        const sepX = first + widths[gi] + between / 2;
        const sep = new THREE.Mesh(
          new THREE.BoxGeometry(0.04, R.sepHeight * 2.2, 0.62),
          new THREE.MeshStandardMaterial({ color: C.gold, emissive: C.gold, emissiveIntensity: 0.4, metalness: 0.4, roughness: 0.4 }),
        );
        sep.position.set(sepX, R.y - ballR + R.sepHeight, R.z);
        this.rackGroup.add(sep);
      }
    });

    this.scene.add(this.rackGroup);
  }

  disposeRack() {
    if (!this.rackGroup) return;
    this.rackGroup.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    this.scene.remove(this.rackGroup);
    this.rackGroup = null;
    this.slots = [];
  }

  slotPosition(groupIndex, idx) {
    return (this.slots[groupIndex] && this.slots[groupIndex][idx]) || new THREE.Vector3(0, CONFIG.exit.rack.y, CONFIG.exit.rack.z);
  }

  /** Continuous curve: capture point → tube → chute → the target rack slot. */
  buildPath(startVec, groupIndex, idx) {
    const pts = [startVec.clone()];
    for (const p of CONFIG.exit.tube) pts.push(V(p));
    for (const p of CONFIG.exit.chute) pts.push(V(p));
    pts.push(this.slotPosition(groupIndex, idx));
    const clean = [pts[0]];
    for (let i = 1; i < pts.length; i++) if (pts[i].distanceTo(clean[clean.length - 1]) > 0.05) clean.push(pts[i]);
    return new THREE.CatmullRomCurve3(clean, false, 'catmullrom', 0.5);
  }
}

function troughGeometry(curve, halfWidth, wallH) {
  const t = 0.04;
  const s = new THREE.Shape();
  s.moveTo(-halfWidth - t, wallH); s.lineTo(-halfWidth - t, -t); s.lineTo(halfWidth + t, -t); s.lineTo(halfWidth + t, wallH);
  s.lineTo(halfWidth, wallH); s.lineTo(halfWidth, 0); s.lineTo(-halfWidth, 0); s.lineTo(-halfWidth, wallH); s.closePath();
  return new THREE.ExtrudeGeometry(s, { steps: 60, bevelEnabled: false, extrudePath: curve });
}

function offsetCurve(curve, dx, dy) {
  const pts = curve.getPoints(24).map((p) => new THREE.Vector3(p.x + dx, p.y + dy, p.z));
  return new THREE.CatmullRomCurve3(pts, false);
}
