/**
 * Camera director — frontal and calm. One base composition for the whole draw:
 *  • Landscape/desktop: the whole machine (drum top → tube → tray) inside the
 *    band-reserved canvas; pull back only as far as needed so nothing slips under
 *    the bottom control band.
 *  • Portrait/phone: a dedicated close composition — the drum is the dominant
 *    object, filling the full width (its empty side rim may run off-screen), the
 *    machine fills the frame vertically and the tray sits just above the button.
 *
 * The only movement is during a ball's exit: a gentle zoom IN toward the ball
 * (the subject is the BALL, not the whole drum) that eases back afterwards. Never
 * a zoom OUT. Everything here is visual — physics is never touched.
 */
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { State } from '../sim/draw.js';

const DRUM_HALF_W = CONFIG.drum.glassOuter; // ~3.14
// How much wider than the frame the drum may run in portrait (its empty glass
// rim is allowed off-screen so the machine reads big and close).
const PORTRAIT_MAX_FILL = 1.3;

const R = CONFIG.drum.radius;
const RK = CONFIG.exit.rack;
const TOP_PT = new THREE.Vector3(0, R + 0.32, 0);                     // glass top
const TRAY_PT = new THREE.Vector3(0, RK.y - CONFIG.ball.radius - 0.16, RK.z + 0.36); // tray front-bottom
const EXIT_ZONE = new THREE.Vector3(0, -2.3, 4.1);                    // outlet / rack area

export class CameraDirector {
  constructor(camera) {
    this.camera = camera;
    this.shots = CONFIG.camera.shots;
    this.pos = new THREE.Vector3(...this.shots.MAIN.pos);
    this.look = new THREE.Vector3(...this.shots.MAIN.target);
    this._pos = this.pos.clone();
    this._look = this.look.clone();
    this.shot = 'MAIN';
    this._dir = new THREE.Vector3();
    this._ndc = new THREE.Vector3();
    this._cl = new THREE.Vector3();
    this._cp = new THREE.Vector3();
    this._look0 = new THREE.Vector3();
    this._t = new THREE.Vector3();
    this._fitCam = new THREE.PerspectiveCamera(camera.fov, 1, camera.near, camera.far);
    this.rackBounds = null;   // world-space Box3 of the lower rack (set from main)
    this._rackCorners = null; // its extreme corners (indices 0..3 = bottom edge)
  }

  /** Cache the rack bounding box + the extreme corners used for the final fit. */
  setRackBounds(box) {
    this.rackBounds = box || null;
    this._rackCorners = null;
    if (!box) return;
    const { min, max } = box;
    this._rackCorners = [
      new THREE.Vector3(min.x, min.y, max.z), new THREE.Vector3(max.x, min.y, max.z), // bottom front L/R
      new THREE.Vector3(min.x, min.y, min.z), new THREE.Vector3(max.x, min.y, min.z), // bottom back  L/R
      new THREE.Vector3(min.x, max.y, max.z), new THREE.Vector3(max.x, max.y, max.z), // top    front L/R
    ];
  }

  /** NDC of a world point for a trial camera (look pan `oy`, distance `dist`). */
  _project(point, look0, dir, dist, oy, aspect) {
    const cam = this._fitCam;
    cam.fov = this.camera.fov; cam.aspect = aspect;
    cam.near = this.camera.near; cam.far = this.camera.far;
    const L = this._cl.set(look0.x, look0.y + oy, look0.z);
    const P = this._cp.copy(dir).multiplyScalar(dist).add(L);
    cam.position.copy(P); cam.up.set(0, 1, 0); cam.lookAt(L);
    cam.updateMatrixWorld(true); cam.updateProjectionMatrix();
    return this._ndc.copy(point).project(cam);
  }

  /** NDC-y of a world point for a trial camera (look pan `oy`, distance `dist`). */
  _ndcY(point, look0, dir, dist, oy, aspect) {
    return this._project(point, look0, dir, dist, oy, aspect).y;
  }

  /** FINAL frame only: one small, purely frontal pull-back so the whole lower rack
   *  (all parked balls — first and last included, plus the end seats) fits inside a
   *  safe area. Keeps the base composition's target/direction EXACTLY (never sideways,
   *  never rotated) and only grows the distance. Receding along `dir` moves every
   *  rack corner monotonically toward frame centre, so horizontal cropping is fixed
   *  while the bottom safe margin only widens. If the rack already fits (narrow
   *  games / wide desktop frames) the distance is unchanged — zero motion. */
  _fitRack(look0, dir, aspect) {
    const cs = this._rackCorners;
    if (!cs) return;
    const xLim = 1 - 2 * 0.05;               // ~5% horizontal safe margin each side
    const oy = this.look.y - look0.y;        // keep the base vertical anchor exactly
    let dist = this.pos.distanceTo(this.look); // base distance — only ever grows
    for (let iter = 0; iter < 40; iter++) {
      let over = 0;
      for (const c of cs) over = Math.max(over, Math.abs(this._project(c, look0, dir, dist, oy, aspect).x) - xLim);
      if (over <= 0.002) break;
      dist *= 1 + Math.min(0.12, over * 0.5 + 0.01); // back off just enough
    }
    this.pos.copy(dir).multiplyScalar(dist).add(this.look);
  }

  /** Landscape: smallest distance (≥ start) so both fit points stay in the safe
   *  vertical band. Only pulls BACK, so the drum is never shrunk needlessly. */
  _fitDistance(look0, dir, aspect, startDist, mTop, mBot) {
    const topLim = 1 - 2 * mTop, botLim = -1 + 2 * mBot;
    let d = startDist;
    for (let iter = 0; iter < 48; iter++) {
      const over = Math.max(
        this._ndcY(TOP_PT, look0, dir, d, 0, aspect) - topLim,
        botLim - this._ndcY(TRAY_PT, look0, dir, d, 0, aspect),
      );
      if (over <= 0.002) break;
      d *= 1 + Math.min(0.12, over * 0.5 + 0.015);
    }
    return d;
  }

  /** Portrait: the drum dominates. Come as CLOSE as allowed (drum may spill past
   *  the sides), keep the glass top and the tray in frame, and anchor the tray to
   *  the bottom so it sits right above the button. */
  _framePortrait(look0, dir, aspect) {
    const topLim = 1 - 2 * 0.035, botLim = -1 + 2 * 0.045;
    const vHalfTan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5));
    // Closest allowed distance (drum up to PORTRAIT_MAX_FILL× the frame width).
    let dist = (DRUM_HALF_W / PORTRAIT_MAX_FILL) / (vHalfTan * aspect);
    let oy = 0;
    for (let outer = 0; outer < 18; outer++) {
      // Vertical pan so the tray sits on the bottom margin (monotonic in oy).
      let lo = -4, hi = 10;
      for (let b = 0; b < 20; b++) {
        oy = (lo + hi) * 0.5;
        if (this._ndcY(TRAY_PT, look0, dir, dist, oy, aspect) > botLim) lo = oy; else hi = oy;
      }
      oy = (lo + hi) * 0.5;
      if (this._ndcY(TOP_PT, look0, dir, dist, oy, aspect) <= topLim + 0.002) break;
      dist *= 1.04; // glass top still cropping → back off a touch, re-anchor
    }
    this.look.set(look0.x, look0.y + oy, look0.z);
    this.pos.copy(dir).multiplyScalar(dist).add(this.look);
  }

  update(dt, state, focus) {
    const exiting = state === State.TRANSIT || state === State.DISPLAY;
    // Base composition (whole machine), always from the fixed frontal MAIN shot.
    this.pos.set(...this.shots.MAIN.pos);
    this.look.set(...this.shots.MAIN.target);
    const aspect = this.camera.aspect || 1.6;
    const portrait = aspect < 1.05;
    this._dir.copy(this.pos).sub(this.look).normalize();
    this._look0.copy(this.look);
    if (portrait) {
      this._framePortrait(this._look0, this._dir, aspect);
    } else {
      const dist = this._fitDistance(this._look0, this._dir, aspect, this.pos.distanceTo(this.look), 0.045, 0.06);
      this.pos.copy(this._dir).multiplyScalar(dist).add(this.look);
    }
    // FINAL frame: once the draw is COMPLETE, apply one small frontal pull-back so
    // every ball in the lower rack is fully framed (computed fit, not a fixed zoom).
    if (state === State.COMPLETE) this._fitRack(this._look0, this._dir, aspect);
    this.shot = exiting ? 'BALL_EXIT' : 'MAIN';

    // During the exit, the BALL is the subject: zoom IN toward it (never OUT) and
    // follow it into the tray. Eases back to the base composition afterwards.
    if (exiting) {
      const t = (focus && focus.lengthSq() > 1e-6) ? this._t.copy(focus) : this._t.copy(EXIT_ZONE);
      this.look.lerp(t, portrait ? 0.6 : 0.45);
      const zin = portrait ? 0.7 : 0.82; // < 1 ⇒ move closer to the ball
      this.pos.sub(this.look).multiplyScalar(zin).add(this.look);
    }

    const k = 1 - Math.exp(-dt * 3.0);
    this._pos.lerp(this.pos, k);
    this._look.lerp(this.look, k);
    // In resting states, snap once essentially there so the camera is truly static
    // (no perpetual asymptotic micro-drift → perfectly sharp, still frame).
    if ((state === State.IDLE || state === State.COMPLETE)
      && this._pos.distanceToSquared(this.pos) < 4e-6 && this._look.distanceToSquared(this.look) < 4e-6) {
      this._pos.copy(this.pos); this._look.copy(this.look);
    }
    this.camera.position.copy(this._pos);
    this.camera.lookAt(this._look);
  }

  snap() {
    this._pos.copy(this.pos);
    this._look.copy(this.look);
    this.camera.position.copy(this._pos);
    this.camera.lookAt(this._look);
  }
}
