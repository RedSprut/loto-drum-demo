/**
 * The internal mixing mechanism — light and precise, and deliberately NOT planar.
 *
 *   • Primary rotor: a thin shaft on X with 6 thin arms tipped with small soft
 *     capsule pushers. Each pusher sits at a different depth (X) and tilt, so it
 *     strikes front / middle / back layers and scatters balls in 3D.
 *   • Secondary mixer: a small 3-arm rotor on a TILTED axis near the back, spun
 *     out of sync (and often reversed) so no steady ring of balls can form.
 *
 * Both are position-controlled KINEMATIC bodies; every visual part has a matching
 * Rapier collider (cylinders for arms, capsules for pushers). Ball motion and
 * spin come only from real contacts — never a scripted path.
 */
import * as THREE from 'three';
import { CONFIG } from '../config.js';

const X_AXIS = new THREE.Vector3(1, 0, 0);

export class Rotor {
  constructor(scene, physics, { debug = false } = {}) {
    this.scene = scene;
    this.physics = physics;
    this.debug = debug;
    this.anglePrimary = 0; this.angleSecondary = 0;
    this.speedPrimary = 0; this.speedSecondary = 0;
    this.targetPrimary = 0; this.targetSecondary = 0;
    this._qp = new THREE.Quaternion(); this._qs = new THREE.Quaternion();
    this._build();
  }

  _pusherMat() {
    return this.debug
      ? new THREE.MeshBasicMaterial({ color: 0xff3355, wireframe: true })
      : new THREE.MeshPhysicalMaterial({ color: 0xe4e7ec, metalness: 0, roughness: 0.62, clearcoat: 0.15, clearcoatRoughness: 0.5, envMapIntensity: 0.8 });
  }

  _build() {
    const Rr = CONFIG.rotor;
    const R = CONFIG.drum.radius;
    const ballR = CONFIG.ball.radius;
    const shaftHalf = R * Rr.shaftSpanFrac;
    const silver = new THREE.MeshStandardMaterial({ color: CONFIG.colors.silver, metalness: 0.9, roughness: 0.28, envMapIntensity: 1.0 });
    const soft = this._pusherMat();

    // ── Primary rotor ──
    this.bodyP = this.physics.createKinematic({ x: 0, y: 0, z: 0 });
    this.groupP = new THREE.Group();
    const toX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    this.physics.attachCylinder(this.bodyP, shaftHalf, Rr.shaftRadius, { x: 0, y: 0, z: 0 }, toX, { friction: 0.18 });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(Rr.shaftRadius, Rr.shaftRadius, shaftHalf * 2, 20), silver);
    shaft.rotation.z = Math.PI / 2;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(Rr.hubRadius, Rr.hubRadius, ballR * 1.5, 24), silver);
    hub.rotation.z = Math.PI / 2;
    this.groupP.add(shaft, hub);

    const armGeo = new THREE.CylinderGeometry(Rr.armRadius, Rr.armRadius, 1, 12);
    const pusherGeo = new THREE.CapsuleGeometry(Rr.pusherRadius, Rr.pusherHalf * 2, 8, 14);
    let minTipGap = Infinity;
    for (let k = 0; k < Rr.armCount; k++) {
      const angle = (k / Rr.armCount) * Math.PI * 2;
      const lay = Rr.pusherLayout[k % Rr.pusherLayout.length];
      const xk = lay.depth * shaftHalf;
      const tilt = THREE.MathUtils.degToRad(lay.tilt);
      const ryz = Math.sqrt(Math.max(0.01, R * R - xk * xk));
      const tipTarget = ryz - Rr.wallGap;
      const armOuter = tipTarget - Rr.pusherRadius;
      const armLen = armOuter - Rr.armInner;
      const armMid = (Rr.armInner + armOuter) / 2;
      minTipGap = Math.min(minTipGap, ryz - tipTarget);

      const c = Math.cos(angle), s = Math.sin(angle);
      const dir = new THREE.Vector3(0, c, s);
      const qArm = new THREE.Quaternion().setFromAxisAngle(X_AXIS, angle);
      this.physics.attachCylinder(this.bodyP, armLen / 2, Rr.armRadius, { x: xk, y: armMid * c, z: armMid * s }, qArm, { friction: 0.18 });
      const arm = new THREE.Mesh(armGeo, silver);
      arm.scale.set(1, armLen, 1); arm.position.set(xk, armMid * c, armMid * s); arm.quaternion.copy(qArm);

      // Pusher: tangential capsule, tilted about its radial axis.
      const qPush = new THREE.Quaternion().setFromAxisAngle(dir, tilt)
        .multiply(new THREE.Quaternion().setFromAxisAngle(X_AXIS, angle + Math.PI / 2));
      const pp = { x: xk, y: armOuter * c, z: armOuter * s };
      this.physics.attachCapsule(this.bodyP, Rr.pusherHalf, Rr.pusherRadius, pp, qPush, { friction: 0.22, restitution: 0.5 });
      const pusher = new THREE.Mesh(pusherGeo, soft);
      pusher.position.set(pp.x, pp.y, pp.z); pusher.quaternion.copy(qPush);
      this.groupP.add(arm, pusher);
    }
    this.scene.add(this.groupP);
    if (minTipGap >= ballR * 2) console.error(`Rotor pushers do not reach the ball bed (tip gap ${minTipGap.toFixed(3)} ≥ ${(ballR * 2).toFixed(3)})`);
    else if (this.debug) console.log(`ROTOR primary pushers reach within ${minTipGap.toFixed(3)} of the wall (ball dia ${(ballR * 2).toFixed(3)})`);

    // ── Secondary mixer (tilted axis) ──
    const S = Rr.secondary;
    this._secAxis = new THREE.Vector3(...S.axis).normalize();
    this._secBase = new THREE.Quaternion().setFromUnitVectors(X_AXIS, this._secAxis);
    this._secCenter = new THREE.Vector3(...S.center);
    this.bodyS = this.physics.createKinematic({ x: this._secCenter.x, y: this._secCenter.y, z: this._secCenter.z });
    this.groupS = new THREE.Group();
    this.groupS.position.copy(this._secCenter);
    const secOuter = S.radiusFrac * R;
    const secArmGeo = new THREE.CylinderGeometry(S.armRadius, S.armRadius, 1, 10);
    const secPushGeo = new THREE.CapsuleGeometry(S.pusherRadius, S.pusherHalf * 2, 8, 12);
    for (let k = 0; k < S.armCount; k++) {
      const angle = (k / S.armCount) * Math.PI * 2;
      const c = Math.cos(angle), s = Math.sin(angle);
      const inner = 0.2, armLen = secOuter - inner, armMid = (inner + secOuter) / 2;
      // Local frame: arms in the Y-Z plane (spin axis = local X); base maps X→axis.
      const localArmQ = new THREE.Quaternion().setFromAxisAngle(X_AXIS, angle);
      const qArm = this._secBase.clone().multiply(localArmQ);
      const localArmPos = new THREE.Vector3(0, armMid * c, armMid * s).applyQuaternion(this._secBase);
      this.physics.attachCylinder(this.bodyS, armLen / 2, S.armRadius, { x: localArmPos.x, y: localArmPos.y, z: localArmPos.z }, qArm, { friction: 0.18 });
      const arm = new THREE.Mesh(secArmGeo, silver);
      arm.scale.set(1, armLen, 1); arm.position.copy(localArmPos); arm.quaternion.copy(qArm);

      const localPushQ = new THREE.Quaternion().setFromAxisAngle(X_AXIS, angle + Math.PI / 2);
      const qPush = this._secBase.clone().multiply(localPushQ);
      const localPushPos = new THREE.Vector3(0, secOuter * c, secOuter * s).applyQuaternion(this._secBase);
      this.physics.attachCapsule(this.bodyS, S.pusherHalf, S.pusherRadius, { x: localPushPos.x, y: localPushPos.y, z: localPushPos.z }, qPush, { friction: 0.22, restitution: 0.5 });
      const pusher = new THREE.Mesh(secPushGeo, this._pusherMat());
      pusher.position.copy(localPushPos); pusher.quaternion.copy(qPush);
      this.groupS.add(arm, pusher);
    }
    this.scene.add(this.groupS);
  }

  /** @param {number} primary rad/s  @param {number} secondary rad/s */
  setSpeed(primary, secondary = 0) { this.targetPrimary = primary; this.targetSecondary = secondary; }

  reset() {
    this.anglePrimary = 0; this.angleSecondary = 0;
    this.speedPrimary = 0; this.speedSecondary = 0;
    this.targetPrimary = 0; this.targetSecondary = 0;
  }

  update(dt) {
    const a = CONFIG.rotor.accel;
    this.speedPrimary = THREE.MathUtils.damp(this.speedPrimary, this.targetPrimary, a, dt);
    this.speedSecondary = THREE.MathUtils.damp(this.speedSecondary, this.targetSecondary, a, dt);

    this.anglePrimary += this.speedPrimary * dt;
    this._qp.setFromAxisAngle(X_AXIS, this.anglePrimary);
    this.groupP.quaternion.copy(this._qp);
    this.bodyP.setNextKinematicRotation({ x: this._qp.x, y: this._qp.y, z: this._qp.z, w: this._qp.w });

    this.angleSecondary += this.speedSecondary * dt;
    this._qs.copy(this._secBase).multiply(new THREE.Quaternion().setFromAxisAngle(X_AXIS, this.angleSecondary));
    this.groupS.quaternion.copy(this._qs);
    this.bodyS.setNextKinematicRotation({ x: this._qs.x, y: this._qs.y, z: this._qs.z, w: this._qs.w });
  }
}
