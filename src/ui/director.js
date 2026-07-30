/**
 * Camera director — deliberately near-static and always frontal. It never orbits
 * the drum, never shows the back, never uses random angles. Each draw stage maps
 * to a pre-designed frontal shot (main / slight-zoom mixing / outlet / display),
 * and the rig critically-damps between them. On portrait screens it pulls back a
 * little so the whole machine stays in frame.
 */
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { State } from '../sim/draw.js';

const SHOT_FOR = {
  [State.IDLE]: 'MAIN',
  [State.STARTUP]: 'MAIN',
  [State.MIXING]: 'MIXING',
  [State.ARMING]: 'MIXING',
  [State.CAPTURING]: 'MIXING',
  [State.TRANSIT]: 'OUTLET',
  [State.DISPLAY]: 'DISPLAY',
  [State.RELOAD]: 'MAIN',
  [State.COMPLETE]: 'MAIN',
};

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
    const name = SHOT_FOR[state] || 'MAIN';
    this.shot = name;
    const shot = this.shots[name];
    this.pos.set(...shot.pos);
    this.look.set(...shot.target);

    // While a ball travels, dip the look toward it a touch (no sideways move).
    if (name === 'OUTLET' && focus) this.look.lerp(focus, 0.25);

    // Portrait pull-back keeps the whole machine framed.
    const aspect = this.camera.aspect || 1.6;
    if (aspect < 0.95) {
      const pull = Math.min(2.2, 1.1 / aspect);
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
