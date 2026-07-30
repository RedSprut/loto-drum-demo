/**
 * Turbulent air-mix field — the second half of a real "gravity-air" TV lottery
 * machine. The rotor mechanically STRIKES balls (linear + angular momentum); this
 * field keeps the whole sphere volume alive so balls never lie on the floor nor
 * pile on the ceiling:
 *
 *   • a central UPDRAFT (strong near the vertical axis, low down) that fades with
 *     height and turns into a mild DOWNDRAFT out near the walls → a toroidal
 *     fountain that fills the volume and recirculates;
 *   • a gentle SWIRL around the vertical axis;
 *   • coherent 3D value-noise TURBULENCE so every ball gets its own chaotic push
 *     (no synchronized motion, no periodicity, independent histories).
 *
 * It is a force field only — it perturbs real rigid bodies; the solver resolves
 * every real collision. It never selects or steers a specific ball.
 */
import { CONFIG } from '../config.js';
import { makeNoise3 } from '../util/prng.js';

export class AirMix {
  constructor() {
    this.noise = makeNoise3();
    this.t = 0;
  }

  /** @param {Array} bodies active ball rigid bodies  @param {number} dt seconds */
  apply(bodies, dt, intensity = 1) {
    this.t += dt;
    const A = CONFIG.air;
    const R = CONFIG.drum.radius;
    const coneR = A.coneR * R;
    const span = A.topY + R;
    const ns = A.turbScale;
    const tt = this.t * A.turbTime;

    for (const body of bodies) {
      const p = body.translation();
      const hr = Math.hypot(p.x, p.z) || 1e-4;

      // Central updraft → edge downdraft, tapering with height.
      let cone = 1 - (hr / coneR) * (hr / coneR);
      if (cone < -A.edgeDown) cone = -A.edgeDown;
      const heightTaper = Math.max(0, Math.min(1, (A.topY - p.y) / span));
      let fx = 0, fy = A.lift * cone * heightTaper * intensity, fz = 0;

      // Swirl around Y.
      fx += (-p.z / hr) * A.swirl;
      fz += (p.x / hr) * A.swirl;

      // Coherent turbulence (animated value noise), per-axis phase offsets.
      fx += this.noise(p.x * ns + tt, p.y * ns, p.z * ns) * A.turb;
      fy += this.noise(p.x * ns, p.y * ns + tt, p.z * ns) * A.turb * 0.8;
      fz += this.noise(p.x * ns, p.y * ns, p.z * ns + tt) * A.turb;

      body.addForce({ x: fx, y: fy, z: fz }, true);
    }
  }
}
