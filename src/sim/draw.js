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
import { AirMix } from './airmix.js';
import { poolsOf, drawQueueOf } from '../games.js';

export const State = Object.freeze({
  IDLE: 'idle', STARTUP: 'startup', MIXING: 'mixing', ARMING: 'arming',
  CAPTURING: 'capturing', TRANSIT: 'transit', DISPLAY: 'display', RELOAD: 'reload',
  STOPPING: 'stopping', FINAL_SETTLING: 'final-settling', COMPLETE: 'complete',
});

const TRANSIT_SECONDS = 2.2;
const smoothstep = (t) => t * t * (3 - 2 * t);

/** SINGLE source of truth for which force subsystems may act in each state.
 *  In IDLE / FINAL_SETTLING / COMPLETE nothing artificial is allowed — only
 *  gravity + collisions + friction + damping. */
export function getActiveForcePolicy(state) {
  const mixing = state === State.STARTUP || state === State.MIXING || state === State.CAPTURING
    || state === State.TRANSIT || state === State.DISPLAY || state === State.RELOAD;
  return {
    mixer: mixing,                 // rotor + secondary + air field + anti-stall
    suction: state === State.CAPTURING,
    // The analytic containment wall is the drum boundary; it is only needed while
    // balls can reach the wall (mixing) or are draining down (STOPPING/settling).
    wall: mixing || state === State.STOPPING || state === State.FINAL_SETTLING,
  };
}

export class DrawController {
  constructor({ balls, drum, rotor, exit, camera }, hooks = {}) {
    this.balls = balls; this.drum = drum; this.rotor = rotor; this.exit = exit; this.camera = camera;
    this.hooks = hooks; // {onState, onDraw, onDone, onLayout}
    this.state = State.IDLE;
    this.timer = 0;
    this.winner = null;
    this._path = null; this._u = 0; this._tmp = new THREE.Vector3();
    this._revealed = false; this._revealAt = 0; this._debug = false;
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
    // IDLE: rotor is a static, pass-through decoration so freshly spawned balls
    // fall straight to the bottom and rest (no piling on the shaft, no forces).
    // High damping makes the spawned bed settle within ~2 s.
    this.winner = null; this.rotor.reset(); this.rotor.setSolid(false); this.drum.setWallSolid(true); this.rotor.setSpeed(CONFIG.rotor.speedIdle);
    this.balls.setDamping(CONFIG.settle.damping);
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
    this._phaseIdx = 0; this._phaseTimer = 0; this._warned = false;
    this.rotor.reset(); this.rotor.setSolid(true); this.drum.setWallSolid(true); this._applyPhase(); // start the mixer immediately
    this.drum.closeGate();
    this._set(State.STARTUP);
  }

  reset() { this.loadProfile(this.profile); }

  /** The mixer (rotor phases + air field) — runs CONTINUOUSLY through every state
   *  of an active draw so the bed never goes calm between picks. */
  _driveMixer(dt, liftScale = 1) {
    this.balls.keepAwake();
    this._runMixPhases(dt);
    this.air.apply(this.balls.activeItems(), dt, liftScale);
    this._trackActivity(dt);
  }

  update(dt) {
    this.timer += dt;
    switch (this.state) {
      case State.IDLE:
        // Let freshly spawned balls settle and go to sleep. NO forces here.
        this.balls.updateSettling(dt);
        break;
      case State.STARTUP:
        this._driveMixer(dt);
        if (this.timer > CONFIG.draw.startupSeconds) this._set(State.MIXING);
        break;
      case State.MIXING:
        this._driveMixer(dt);
        if (this.timer > CONFIG.draw.mixSeconds) { this.drum.openGate(); this._set(State.CAPTURING); }
        break;
      case State.CAPTURING:
        this._driveMixer(dt, CONFIG.air.captureLiftScale); // keep mixing, just ease the updraft
        this._captureDrain();
        this._watchCapture();
        break;
      case State.TRANSIT:
        this._driveMixer(dt);       // the REST keep mixing while the winner travels
        this._advanceTransit(dt);
        break;
      case State.DISPLAY:
        this._driveMixer(dt);       // the REST keep mixing
        // Reveal the number ONLY after the ball has settled AND faced the camera.
        if (!this._revealed) {
          const w = this.winner;
          if (w && w.parked && (w.facingDot ?? 0) >= CONFIG.reveal.facingDot && !w.ts.facing) {
            w.ts.facing = performance.now(); // moment the number first faced the viewer
          }
          // Publish only after the ball has RESTED + faced the camera for a short
          // beat, so the viewer clearly sees the physical ball before the number.
          const held = w?.ts.facing && (performance.now() - w.ts.facing) / 1000 >= CONFIG.reveal.hold;
          if (w && w.parked && (held || this.timer > CONFIG.reveal.maxWait)) this._reveal();
        }
        if (this._revealed && (this.timer - this._revealAt) > CONFIG.draw.displaySeconds) this._afterDisplay();
        break;
      case State.RELOAD:
        this._driveMixer(dt);
        if (this.timer > CONFIG.draw.reloadSeconds) this._set(State.MIXING);
        break;
      case State.STOPPING:
        // Rotor coasts to a stop. NO mixer, NO air, NO anti-stall/suction — every
        // artificial force is off here (balls keep whatever velocity they had and
        // fall; they are woken ONCE on entering FINAL_SETTLING, not every frame).
        this.rotor.setSpeed(0, 0);
        if (this.timer > CONFIG.draw.stoppingSeconds) {
          this.balls.restoreDynamic(); // remaining balls: dynamic, full gravity, woken once
          this._set(State.FINAL_SETTLING);
        }
        break;
      case State.FINAL_SETTLING:
        // Only gravity + collisions + friction + damping now. Balls fall, collide,
        // settle and are allowed to SLEEP. End once nothing is suspended and calm.
        this.rotor.setSpeed(0, 0);
        this.balls.updateSettling(dt);
        {
          const st = this.balls.settleStatus();
          // Done once nothing is suspended and the bed is calm (or the safety cap).
          if ((st.suspended === 0 && this.timer > 2.0) || st.allSettled || this.timer > CONFIG.settle.maxSeconds) {
            this.balls.assertConservation();
            this._set(State.COMPLETE);
          }
        }
        break;
      case State.COMPLETE:
        // Keep letting the leftover bed settle + SLEEP so the final frame becomes
        // (and stays) perfectly still — no artificial forces, just rest detection.
        this.balls.updateSettling(dt);
        break;
      default: break;
    }
  }

  _trackActivity(dt) {
    this.mixActivity = this.balls.activity();
    if (this.mixActivity < 0.3) this.stalledFor += dt; else this.stalledFor = 0;
    if (this.stalledFor > 2.5 && !this._warned) {
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

  /** Localized suction at the bottom-centre drain — pulls a passing ball out
   *  while the rest of the sphere keeps mixing. Uniform, never by number. */
  _captureDrain() {
    const C = CONFIG.capture;
    const boost = this.timer > CONFIG.draw.captureTimeout ? C.escalate : 1;
    for (const it of this.balls.activeItems()) {
      const p = it.body.translation();
      if (p.y < C.drainY && Math.hypot(p.x, p.z) < C.drainR) {
        it.body.addForce({ x: -p.x * C.inward * boost, y: -C.down * boost, z: -p.z * C.inward * boost }, true);
      }
    }
  }

  _watchCapture() {
    let winner = null, lowest = this.exit.captureY;
    for (const it of this.balls.active()) {
      const y = it.body.translation().y;
      if (y < lowest) { lowest = y; winner = it; }
    }
    if (!winner) return;
    const { RAPIER } = this.balls.physics;
    winner.drawn = true;
    winner.lifecycle = 'in-transit'; // SAME physical entity — never cloned/replaced
    winner.resultPool = this.currentPoolId; // the RESULT group (may differ from physical pool)
    winner.ts = { capture: performance.now() };
    this.winner = winner;
    this._revealed = false;       // the number is NOT shown yet — only after it settles + faces
    this._lastWinnerValue = null; // status reverts to «Выбор шара…» until the reveal
    this.drum.closeGate();

    winner.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    const s = winner.body.translation();
    this._tmp.set(s.x, s.y, s.z);
    this._path = this.exit.buildPath(this._tmp, this.groupIndex, this.idxInGroup);
    this._u = 0;

    this.balls.assertConservation();
    this._set(State.TRANSIT); // top UI stays "Выбор шара…" (no chip)
  }

  _advanceTransit(dt) {
    this._u = Math.min(1, this._u + dt / TRANSIT_SECONDS);
    const p = this._path.getPoint(smoothstep(this._u), this._tmp);
    this.winner.body.setNextKinematicTranslation({ x: p.x, y: p.y, z: p.z });
    if (this._u > 0.55 && !this.winner.ts.chute) this.winner.ts.chute = performance.now();
    if (this._u >= 1) {
      this.winner.mesh.position.copy(p);  // freeze the mesh exactly in its slot
      this.winner.parked = true;          // now turns to face the camera (mesh only)
      this.winner.lifecycle = 'in-rack';
      this.winner.ts.rack = this.winner.ts.settled = performance.now();
      this.balls.assertConservation();
      this._set(State.DISPLAY);
    }
  }

  /** Reveal the top-UI number ONLY once the physical ball is in its rack slot,
   *  settled and turned to face the viewer. Guarded by assertions. */
  _reveal() {
    const w = this.winner;
    if (w.lifecycle !== 'in-rack') throw new Error(`Result revealed before ball reached rack: #${w.value}`);
    if (!w.parked) throw new Error(`Result revealed before ball settled: #${w.value}`);
    if ((w.facingDot ?? 0) < 0.9) throw new Error(`Result revealed before number faced viewer: #${w.value}`);
    w.ts.facing = w.ts.facing || performance.now();
    w.ts.reveal = performance.now();
    const poolId = w.resultPool;
    this.resultsByPool[poolId].push(w.value);          // ← the ONLY place a result is published
    if (this.resultsByPool[poolId][this.resultsByPool[poolId].length - 1] !== w.value) {
      throw new Error(`UI/physical ball mismatch: pushed ${this.resultsByPool[poolId].at(-1)} ≠ ball ${w.value}`);
    }
    this._lastWinnerValue = w.value;
    this._revealed = true;
    this._revealAt = this.timer;
    if (this._debug) console.log(`RESULT_REVEAL ballId=${w.id} number=${w.value} pool=${poolId} lifecycle=${w.lifecycle} settled=${!!w.parked} facingDot=${(w.facingDot ?? 0).toFixed(3)} ts=${JSON.stringify(w.ts)}`);
    this.hooks.onDraw?.(w.value, poolId, this.resultsByPool);
  }

  _afterDisplay() {
    this.idxInGroup++;
    const group = this.queue[this.groupIndex];
    if (this.idxInGroup >= group.count) {
      this.groupIndex++;
      this.idxInGroup = 0;
    }
    if (this.groupIndex >= this.queue.length) {
      // Last required ball has settled + faced the camera → sort the UI result,
      // THEN begin winding the mechanism down (STOPPING → FINAL_SETTLING). The
      // rotor becomes pass-through so remaining balls fall to the bottom.
      this.balls.assertConservation();
      this.hooks.onDone?.(this.resultsByPool);
      this.rotor.setSolid(false);
      this._set(State.STOPPING);
      return;
    }
    // Continuing: does the next group need a separate pool loaded? The rotor keeps
    // spinning across the reload (no calm gap).
    const nextPool = this.pools[this.currentPoolId];
    if (this.idxInGroup === 0 && nextPool && nextPool.strategy === 'separate-pool') {
      this.balls.loadPool(nextPool); // keeps parked winners, swaps the in-drum set
      this.balls.assertConservation();
      this._set(State.RELOAD);
    } else {
      this._set(State.MIXING);
    }
  }
}
