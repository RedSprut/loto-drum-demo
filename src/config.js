/**
 * Central tuning for the spherical, mechanical gravity-mix lottery machine.
 *
 * Scale note: the chamber has an inner radius of ~3.0 (≈ a real 700 mm sphere at
 * 1 unit ≈ 10 cm) and a lottery ball has radius ~0.20 (≈ 4 cm). Gravity is
 * scaled to match that unit choice so falls look natural, not floaty.
 *
 * Per-game specifics (ball counts, ranges, result layout) live in games.js —
 * this file holds only the physics/visual tunables.
 */
export const CONFIG = {
  draw: {
    startupSeconds: 0.9,  // rotor spins up
    mixSeconds: 3.4,      // forced mixing before the gate arms
    armSeconds: 0.7,      // rotor slows + gate opens
    captureTimeout: 6.5,  // safety: gently funnel toward the throat if nobody drops
    displaySeconds: 1.5,  // hold on the winner in the rack before the next pick
    reloadSeconds: 1.4,   // transition when a separate bonus pool is loaded
  },

  ball: {
    radius: 0.2,
    density: 1.0,
    restitution: 0.55,    // lively bounces so contacts scatter, not clump
    friction: 0.16,       // enough to spin balls on tangential contact…
    linearDamping: 0.16,  // air drag: caps travel so balls recirculate, not pile at the top
    angularDamping: 0.035, // low so SPIN persists (decoupled from linear drag)
    maxLinSpeed: 14,      // clamp so nothing tunnels the wall
    maxAngSpeed: 40,
    segments: [40, 28],
    // Colour sets referenced by a pool's `colorSet`.
    colorSets: {
      multicolor: [0xf2c14e, 0xe85d75, 0x4f78d6, 0x2db39d, 0x8d66c9, 0xf28c3c],
      'bonus-red': [0xe23b4e],
      'bonus-gold': [0xf1c34a],
    },
  },

  drum: {
    radius: 3.0,
    glassOuter: 3.14,
    visSegments: 64,
    latRings: 20,
    lonSegs: 32,
    throatRadius: 0.34,
    gateY: -2.86,
    equatorScaleX: 1.06,
  },

  // Light, precise internal rotor: a thin shaft carrying thin radial arms tipped
  // with small soft pushers that dip into the ball bed. Pushers are staggered in
  // depth and tilt so contacts scatter balls in 3D instead of one flat ring.
  rotor: {
    shaftRadius: 0.05,
    shaftSpanFrac: 0.9,    // shaft length = 2R × frac
    hubRadius: 0.2,
    armCount: 6,
    armRadius: 0.045,
    armInner: 0.3,
    wallGap: 0.14,         // gap between pusher TIP and the inner wall (< ball dia)
    pusherRadius: 0.12,
    pusherHalf: 0.17,
    // Per-pusher depth (X, fraction of shaft half-length) + tilt (deg).
    pusherLayout: [
      { depth: -0.62, tilt: -12 },
      { depth: 0.55, tilt: 10 },
      { depth: -0.28, tilt: 15 },
      { depth: 0.33, tilt: -9 },
      { depth: -0.5, tilt: 7 },
      { depth: 0.46, tilt: -14 },
    ],
    // Small secondary mixer on a tilted axis near the back — breaks planar flow.
    secondary: {
      axis: [0.18, 0.72, 0.67],
      center: [0.0, 0.15, -0.7],
      armCount: 3,
      armRadius: 0.04,
      radiusFrac: 0.5,     // of drum radius
      pusherRadius: 0.1,
      pusherHalf: 0.13,
    },
    speedIdle: 0.0,
    speedStartup: 1.2,
    speedArm: 0.6,         // slowing so the bed can settle
    speedCapture: 0.0,     // stopped: let a ball settle and drop through the throat
    accel: 4.0,            // damp rate toward the target speed
    // MIXING speed phases (primary, secondary), looped, blended via damp. The two
    // are intentionally out of sync (and reverse) so no steady ring forms.
    mixPhases: [
      { duration: 1.6, primary: 2.4, secondary: -1.2 },
      { duration: 1.3, primary: 2.9, secondary: 1.0 },
      { duration: 1.8, primary: 2.1, secondary: -1.5 },
      { duration: 1.4, primary: 2.7, secondary: 1.3 },
    ],
  },

  // Turbulent air-mix field (see sim/airmix.js): a central updraft + edge
  // downdraft + swirl + 3D-noise turbulence that keeps the whole sphere volume
  // alive. Forces are in the same units as a ball's weight (≈ 1.0).
  air: {
    lift: 1.05,     // peak central updraft (just over a ball's weight → it floats there)
    coneR: 0.5,     // horizontal radius fraction where updraft → 0 (then downdraft)
    edgeDown: 0.45, // max downdraft near the walls (edges fall)
    topY: 1.3,      // updraft tapers to zero by this height
    swirl: 0.22,
    turb: 0.55,     // turbulence amplitude (chaotic, independent per ball)
    turbScale: 0.85,
    turbTime: 0.7,
  },

  // Anti-stall: a very weak swirl, applied ONLY when metrics show a real dead
  // zone. Never targets a ball.
  antiStall: { swirl: 0.03, activityFloor: 0.5 },

  // Gentle uniform funnel during CAPTURING so a ball reliably settles into the
  // throat. Applied to every ball equally — it never targets a winner.
  capture: { center: 0.09, down: 0.25, escalate: 2.5 },

  exit: {
    tube: [
      [0.0, -3.05, 0.35],
      [0.0, -2.75, 1.15],
      [0.0, -2.35, 1.95],
      [0.0, -2.35, 2.70],
    ],
    tubeRadius: 0.28,
    chute: [
      [0.0, -2.42, 2.70],
      [0.0, -2.60, 3.30],
      [0.0, -2.74, 3.95],
      [0.0, -2.80, 4.55],
    ],
    chuteHalfWidth: 0.30,
    // Front accumulator rack (linear guide, built dynamically per profile).
    rack: {
      y: -2.74,
      z: 4.9,
      ballGap: 0.18,       // gap between adjacent balls in a group
      groupGap: 0.55,      // extra gap between result groups (main | bonus)
      slotDepth: 0.05,     // shallow seat (≈ 0.25 × ball radius)
      sepHeight: 0.11,     // small divider height
    },
  },

  physics: {
    gravity: -30,
    subSteps: 2,
    maxDt: 1 / 45,
  },

  // Near-static frontal camera. No orbiting, no side views — only a tiny zoom and
  // a downward target dip while a ball exits.
  camera: {
    fov: 40,
    near: 0.1,
    far: 200,
    shots: {
      MAIN:   { pos: [0, 0.4, 12.5], target: [0, -0.4, 0] },
      MIXING: { pos: [0, 0.4, 12.0], target: [0, -0.4, 0] }, // ~4% closer
      OUTLET: { pos: [0, 0.1, 12.0], target: [0, -1.4, 1.9] },
      DISPLAY:{ pos: [0, -0.1, 11.6], target: [0, -1.9, 3.1] },
    },
  },

  quality: {
    presets: {
      ultra:  { dpr: 1.75, shadow: 2048, bloom: true, msaa: 4, env: 512, ballSeg: [44, 30] },
      high:   { dpr: 1.6,  shadow: 1536, bloom: true, msaa: 2, env: 256, ballSeg: [40, 28] },
      medium: { dpr: 1.35, shadow: 1024, bloom: true, msaa: 0, env: 256, ballSeg: [32, 22] },
      low:    { dpr: 1.15, shadow: 0,    bloom: false, msaa: 0, env: 128, ballSeg: [24, 16] },
    },
    order: ['ultra', 'high', 'medium', 'low'],
    downgradeBelowFps: 42,
    upgradeAboveFps: 57,
    sampleSeconds: 2.5,
  },

  colors: {
    backgroundTop: 0x0a1122,
    backgroundBottom: 0x05070f,
    floor: 0x0d1220,
    silver: 0xb9c2d0,
    graphite: 0x181d29,
    gold: 0xcaa85f,
    coolLight: 0x7ea4ff,
    warmLight: 0xffd98a,
  },
};
