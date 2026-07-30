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
    startupSeconds: 1.0,  // rotor spins up (mixer already running)
    mixSeconds: 2.6,      // mixing window before each capture (rotor never stops)
    captureTimeout: 5.0,  // escalate the throat suction if nobody has dropped yet
    displaySeconds: 1.4,  // brief hold on the winner — the rest keep mixing
    reloadSeconds: 1.6,   // separate bonus pool swap (rotor keeps spinning)
    stoppingSeconds: 1.3, // rotor winds down AFTER the last ball has settled
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
    edgeDown: 0.2,  // small downdraft near the walls (don't pin balls to the lower wall)
    topY: 1.3,      // updraft tapers to zero by this height
    swirl: 0.06,    // minimal so balls aren't centrifuged onto the wall
    edgeInward: 0.6, // steady inward pull that grows toward the wall (anti wall-hug)
    turb: 0.95,     // strong turbulence so every ball is constantly buffeted (air machine)
    turbScale: 0.85,
    turbTime: 0.9,
    // Per-ball anti-stall corrective forces (in ball-weight units) + trigger times.
    bottomKick: 1.35, bottomT: 0.4,  // stuck low → strong lift + scatter
    topPush: 1.2, topT: 0.4,         // hanging high → push down, let gravity return it
    wallPull: 2.2, wallT: 0.4,       // pinned to wall → hard inward pull, cut its swirl
    stillKick: 1.0, stillT: 0.3,     // barely moving → firm kick back into the flow
    captureLiftScale: 0.55,          // reduce (not stop) the updraft while capturing
  },

  // Localized suction at the throat during CAPTURING: pulls whatever ball wanders
  // into the bottom-centre drain down and out, WITHOUT stopping the mixer. Applied
  // to every ball in the zone equally — never by number.
  capture: { drainR: 0.6, drainY: -1.6, down: 2.2, inward: 1.2, escalate: 1.8 },

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
    // Only two shots: a fixed frontal MAIN for the whole draw, and a small zoom
    // toward the outlet used ONLY while the drawn ball travels to its slot.
    shots: {
      MAIN:     { pos: [0, 0.2, 12.5], target: [0, -0.4, 0] },
      BALL_EXIT:{ pos: [0, -0.1, 11.8], target: [0, -1.25, 1.8] }, // ~5.6% closer
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
