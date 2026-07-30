/**
 * Camera director — deliberately fixed and frontal. There is exactly ONE shot
 * during the whole draw (MAIN). The only permitted movement is a small zoom
 * toward the outlet while the drawn ball travels to its slot (TRANSIT), which
 * eases back to MAIN afterwards. No orbiting, no side moves, no random angles,
 * no per-state repositioning.
 */
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { State } from '../sim/draw.js';

export class CameraDirector {
  constructor(camera) {
    this.camera = camera;
    this.shots = CONFIG.camera.shots;
    this.pos = new THREE.Vector3(...this.shots.MAIN.pos);
    this.look = new THREE.Vector3(...this.shots.MAIN.target);
    this._pos = this.pos.clone();
    this._look = this.look.clone();
    this.shot = 'MAIN';
  }

  update(dt, state, focus) {
    // Zoom to the outlet only while the ball is exiting; MAIN everywhere else.
    const exiting = state === State.TRANSIT;
    const shot = exiting ? this.shots.BALL_EXIT : this.shots.MAIN;
    this.shot = exiting ? 'BALL_EXIT' : 'MAIN';
    this.pos.set(...shot.pos);
    this.look.set(...shot.target);
    if (exiting && focus) this.look.lerp(focus, 0.2); // follow the ball a touch, no sideways move

    // Portrait pull-back keeps the whole machine framed (composition unchanged
    // during the draw — the pull-back only depends on aspect, not on state).
    const aspect = this.camera.aspect || 1.6;
    if (aspect < 0.95) {
      const pull = Math.min(2.2, 1.12 / aspect);
      this.pos.sub(this.look).multiplyScalar(pull).add(this.look);
    }

    const k = 1 - Math.exp(-dt * 3.0);
    this._pos.lerp(this.pos, k);
    this._look.lerp(this.look, k);
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
