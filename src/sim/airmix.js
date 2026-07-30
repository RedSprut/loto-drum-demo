/**
 * Turbulent air-mix field + per-ball anti-stall corrections.
 *
 * The rotor mechanically STRIKES balls; this field keeps the whole sphere volume
 * alive (central updraft + edge downdraft + swirl + 3D-noise turbulence) AND
 * guarantees that no individual ball is left out: each ball carries a motion
 * tracker, and if it has been still / stuck on the bottom / hanging on top /
 * pinned to the wall for too long, a PHYSICAL corrective force nudges it back
 * into the flow. Corrections are position/state based and identical for every
 * ball — never by number, never a scripted path.
 */
import { CONFIG } from '../config.js';
import { makeNoise3 } from '../util/prng.js';

export class AirMix {
  constructor() {
    this.noise = makeNoise3();
    this.t = 0;
  }

  /**
   * @param {Array} items active ball items ({body, tracker})
   * @param {number} dt
   * @param {number} liftScale global updraft scale (reduced a little while capturing)
   */
  apply(items, dt, liftScale = 1) {
    this.t += dt;
    const A = CONFIG.air;
    const R = CONFIG.drum.radius;
    const coneR = A.coneR * R;
    const span = A.topY + R;
    const ns = A.turbScale;
    const tt = this.t * A.turbTime;

    for (const it of items) {
      const body = it.body, k = it.tracker;
      const p = body.translation();
      const hr = Math.hypot(p.x, p.z) || 1e-4;

      // Base field: central updraft → edge downdraft, tapering with height.
      let cone = 1 - (hr / coneR) * (hr / coneR);
      if (cone < -A.edgeDown) cone = -A.edgeDown;
      const heightTaper = Math.max(0, Math.min(1, (A.topY - p.y) / span));
      let fx = 0, fy = A.lift * cone * heightTaper * liftScale, fz = 0;

      // Swirl (reduced for balls pinned to the wall so they can peel off).
      const swirl = k.wall > A.wallT ? A.swirl * 0.2 : A.swirl;
      fx += (-p.z / hr) * swirl;
      fz += (p.x / hr) * swirl;

      // Steady inward pull that grows toward the wall — keeps balls cycling
      // through the volume instead of hugging the surface.
      const radial = Math.hypot(p.x, p.y, p.z) || 1e-4;
      if (radial > R * 0.6) {
        const inward = A.edgeInward * ((radial - R * 0.6) / (R * 0.4));
        fx += (-p.x / radial) * inward; fy += (-p.y / radial) * inward; fz += (-p.z / radial) * inward;
      }

      // Turbulence — chaotic, independent per ball.
      const nx = this.noise(p.x * ns + tt, p.y * ns, p.z * ns);
      const ny = this.noise(p.x * ns, p.y * ns + tt, p.z * ns);
      const nz = this.noise(p.x * ns, p.y * ns, p.z * ns + tt);
      fx += nx * A.turb; fy += ny * A.turb * 0.8; fz += nz * A.turb;

      // ── Per-ball anti-stall corrections ──
      if (k.bottom > A.bottomT) { fy += A.bottomKick; fx += nx * A.bottomKick; fz += nz * A.bottomKick; }
      if (k.top > A.topT) { fy -= A.topPush; }                       // let gravity bring it down
      if (k.wall > A.wallT) { fx += (-p.x / hr) * A.wallPull; fz += (-p.z / hr) * A.wallPull; } // pull inward
      if (k.still > A.stillT) { fy += A.stillKick; fx += nx * A.stillKick * 1.5; fz += nz * A.stillKick * 1.5; }

      body.addForce({ x: fx, y: fy, z: fz }, true);
    }
  }
}
