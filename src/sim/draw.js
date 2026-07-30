/**
 * Draw state machine — fairness core + data-driven sequencing.
 *
 * The winner of each pick is whichever ball physically drops through the throat
 * first once the gate is armed. Nothing is pre-selected. After capture the ball
 * is switched to a kinematic body and glided along one continuous curve into its
 * rack slot. The SEQUENCE (how many main, how many bonus, which pool) comes from
 * the game profile's draw queue — no "6" is hard-coded.
 *
 * IDLE → STARTUP → MIXING → ARMING → CAPTURING → TRANSIT → DISPLAY
 *        ↑                                                   │
 *        └────────────── (RELOAD for separate bonus pool) ───┘  … → COMPLETE
 */
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { Balls } from '../scene/balls.js';
import { AirMix } from './airmix.js';
import { poolsOf, drawQueueOf } from '../games.js';

export const State = Object.freeze({
  IDLE: 'idle', STARTUP: 'startup', MIXING: 'mixing', ARMING: 'arming',
  CAPTURING: 'capturing', TRANSIT: 'transit', DISPLAY: 'display', RELOAD: 'reload', COMPLETE: 'complete',
});

const TRANSIT_SECONDS = 2.2;
const smoothstep = (t) => t * t * (3 - 2 * t);

export class DrawController {
  constructor({ balls, drum, rotor, exit, camera }, hooks = {}) {
    this.balls = balls; this.drum = drum; this.rotor = rotor; this.exit = exit; this.camera = camera;
    this.hooks = hooks; // {onState, onDraw, onDone, onLayout}
    this.state = State.IDLE;
    this.timer = 0;
    this.winner = null;
    this._path = null; this._u = 0; this._tmp = new THREE.Vector3();
    this.mixActivity = 1; this.stalledFor = 0; this._warned = false;
    this._phaseIdx = 0; this._phaseTimer = 0;
    this.air = new AirMix();
    this.profile = null; this.pools = {}; this.queue = [];
    this.groupIndex = 0; this.idxInGroup = 0;
    this.resultsByPool = {};
  }

  get currentPoolId() { return this.queue[this.groupIndex]?.poolId ?? null; }

  /** Load a profile into IDLE (fresh balls, fresh rack, empty results). */
  loadProfile(profile) {
    this.profile = profile;
    this.pools = poolsOf(profile);
    this.queue = drawQueueOf(profile);
    this.balls.removeAll();
    this.balls.loadPool(profile.mainPool);
    this.exit.buildRack(profile);
    this._resetState();
    this.hooks.onLayout?.(profile);
    this.hooks.onState?.(this.state, null);
  }

  _resetState() {
    this.groupIndex = 0; this.idxInGroup = 0;
    this.resultsByPool = {};
    for (const id of Object.keys(this.pools)) this.resultsByPool[id] = [];
    this.winner = null; this.rotor.reset(); this.rotor.setSpeed(CONFIG.rotor.speedIdle);
    this.drum.closeGate();
    this._set(State.IDLE);
  }

  _set(state) { this.state = state; this.timer = 0; this.hooks.onState?.(state, this._lastWinnerValue ?? null); }

  start() {
    if (this.state !== State.IDLE && this.state !== State.COMPLETE) return;
    // Fresh round: clear everything (incl. parked winners) and reload main pool.
    this.balls.removeAll();
    this.balls.loadPool(this.profile.mainPool);
    this.groupIndex = 0; this.idxInGroup = 0;
    for (const id of Object.keys(this.pools)) this.resultsByPool[id] = [];
    this._lastWinnerValue = null;
    this.rotor.reset(); this.rotor.setSpeed(CONFIG.rotor.speedStartup);
    this.drum.closeGate();
    this._set(State.STARTUP);
  }

  reset() { this.loadProfile(this.profile); }

  update(dt) {
    this.timer += dt;
    const st = this.state;
    if (st === State.STARTUP || st === State.MIXING || st === State.ARMING || st === State.CAPTURING) this.balls.keepAwake();

    switch (this.state) {
      case State.STARTUP:
        this.air.apply(this._activeBodies(), dt);
        if (this.timer > CONFIG.draw.startupSeconds) { this._phaseIdx = 0; this._phaseTimer = 0; this._applyPhase(); this._set(State.MIXING); }
        break;
      case State.MIXING:
        this._runMixPhases(dt);
        this.air.apply(this._activeBodies(), dt);
        this._trackActivity(dt);
        if (this.timer > CONFIG.draw.mixSeconds) { this.rotor.setSpeed(CONFIG.rotor.speedArm, 0); this._set(State.ARMING); }
        break;
      case State.ARMING:
        if (this.timer > CONFIG.draw.armSeconds) { this.drum.openGate(); this.rotor.setSpeed(CONFIG.rotor.speedCapture); this._set(State.CAPTURING); }
        break;
      case State.CAPTURING:
        this._watchCapture(dt);
        break;
      case State.TRANSIT:
        this._advanceTransit(dt);
        break;
      case State.DISPLAY:
        if (this.timer > CONFIG.draw.displaySeconds) this._afterDisplay();
        break;
      case State.RELOAD:
        if (this.timer > CONFIG.draw.reloadSeconds) { this._applyPhase(); this._set(State.MIXING); }
        break;
      default: break;
    }
  }

  _trackActivity(dt) {
    this.mixActivity = this.balls.activity();
    // Denser pools (69–90 balls) naturally move slower, so only flag a genuine
    // stall. Diagnostic only — it never alters the draw.
    if (this.mixActivity < 0.3) this.stalledFor += dt; else this.stalledFor = 0;
    if (this.stalledFor > 2.0 && !this._warned) {
      this._warned = true;
      console.warn(`Low mixing activity (${(this.mixActivity * 100).toFixed(0)}%) — dense pool or dead zone`);
    }
  }

  _applyPhase() {
    const p = CONFIG.rotor.mixPhases[this._phaseIdx];
    this.rotor.setSpeed(p.primary, p.secondary);
  }

  /** Cycle the (out-of-sync) primary/secondary mix speeds so no ring forms. */
  _runMixPhases(dt) {
    this._phaseTimer += dt;
    const phases = CONFIG.rotor.mixPhases;
    if (this._phaseTimer > phases[this._phaseIdx].duration) {
      this._phaseIdx = (this._phaseIdx + 1) % phases.length;
      this._phaseTimer = 0;
      this._applyPhase();
    }
  }

  _activeBodies() {
    const out = [];
    for (const it of this.balls.items) if (!it.drawn && !it.parked) out.push(it.body);
    return out;
  }

  _watchCapture(dt) {
    let winner = null, lowest = this.exit.captureY;
    for (const it of this.balls.active()) {
      const y = it.body.translation().y;
      if (y < lowest) { lowest = y; winner = it; }
    }
    if (!winner) {
      // Gentle uniform funnel toward the throat (all balls equally), escalating
      // if nobody has dropped yet. Never targets a specific ball.
      const C = CONFIG.capture;
      const boost = this.timer > CONFIG.draw.captureTimeout ? C.escalate : 1;
      for (const it of this.balls.active()) {
        const p = it.body.translation();
        it.body.addForce({ x: -p.x * C.center * boost, y: -C.down * boost, z: -p.z * C.center * boost }, true);
      }
      return;
    }
    void dt;
    const { RAPIER } = this.balls.physics;
    winner.drawn = true;
    const poolId = this.currentPoolId;
    this.resultsByPool[poolId].push(winner.value);
    this._lastWinnerValue = winner.value;
    this.winner = winner;
    this.drum.closeGate();
    this._applyPhase();

    winner.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    const s = winner.body.translation();
    this._tmp.set(s.x, s.y, s.z);
    this._path = this.exit.buildPath(this._tmp, this.groupIndex, this.idxInGroup);
    this._u = 0;

    this.hooks.onDraw?.(winner.value, poolId, this.resultsByPool);
    this._set(State.TRANSIT);
  }

  _advanceTransit(dt) {
    this._u = Math.min(1, this._u + dt / TRANSIT_SECONDS);
    const p = this._path.getPoint(smoothstep(this._u), this._tmp);
    this.winner.body.setNextKinematicTranslation({ x: p.x, y: p.y, z: p.z });
    if (this._u >= 1) {
      this.winner.parked = true;
      Balls.faceCamera(this.winner.mesh, this.camera); // turn the number to the viewer
      this._set(State.DISPLAY);
    }
  }

  _afterDisplay() {
    this.idxInGroup++;
    const group = this.queue[this.groupIndex];
    if (this.idxInGroup >= group.count) {
      this.groupIndex++;
      this.idxInGroup = 0;
    }
    if (this.groupIndex >= this.queue.length) {
      this.rotor.setSpeed(CONFIG.rotor.speedIdle);
      this._set(State.COMPLETE);
      this.hooks.onDone?.(this.resultsByPool);
      return;
    }
    // Continuing: does the next group need a separate pool loaded?
    const nextPool = this.pools[this.currentPoolId];
    if (this.idxInGroup === 0 && nextPool && nextPool.strategy === 'separate-pool') {
      this.balls.loadPool(nextPool); // keeps parked winners, swaps the in-drum set
      this.rotor.reset();
      this.rotor.setSpeed(CONFIG.rotor.speedStartup);
      this._set(State.RELOAD);
    } else {
      this._applyPhase();
      this._set(State.MIXING);
    }
  }
}
