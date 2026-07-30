/**
 * Rapier physics wrapper.
 *
 * Why Rapier: it is a modern Rust→WASM engine with deterministic stepping,
 * built-in continuous collision detection (CCD) and fast broadphase — exactly
 * what a drum full of small, fast balls needs so nothing tunnels through the
 * thin glass wall. It ships as a self-contained WASM (base64) in the `-compat`
 * build, so the demo has no build step and no external .wasm to host.
 *
 * This module owns the world and generic body/collider helpers; the concrete
 * drum/ball/rail geometry lives in the scene modules.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from '../config.js';

export async function initRapier() {
  await RAPIER.init();
  return RAPIER;
}

export class PhysicsWorld {
  constructor() {
    this.RAPIER = RAPIER;
    this.world = new RAPIER.World({ x: 0, y: CONFIG.physics.gravity, z: 0 });
    this.world.integrationParameters.numSolverIterations = 6;
    this.bodies = []; // {body, collider, kind, ...}
  }

  /** Fixed body carrying a triangle-mesh collider (drum wall, rail, etc.). */
  addTrimesh(vertices, indices, { friction = 0.35, restitution = 0.25 } = {}) {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const desc = RAPIER.ColliderDesc.trimesh(vertices, indices)
      .setFriction(friction)
      .setRestitution(restitution);
    const collider = this.world.createCollider(desc, body);
    return { body, collider };
  }

  /** Kinematic body (position-controlled) with a trimesh — a spinning drum. */
  addKinematicTrimesh(vertices, indices, opts = {}) {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    const desc = RAPIER.ColliderDesc.trimesh(vertices, indices)
      .setFriction(opts.friction ?? 0.5)
      .setRestitution(opts.restitution ?? 0.2);
    const collider = this.world.createCollider(desc, body);
    return { body, collider };
  }

  /** A single dynamic ball. */
  addBall(x, y, z) {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, y, z)
        .setLinearDamping(CONFIG.ball.linearDamping)
        .setAngularDamping(CONFIG.ball.angularDamping)
        .setCanSleep(true)    // balls CAN rest; the mixer wakes them only while drawing
        .setCcdEnabled(true),
    );
    const desc = RAPIER.ColliderDesc.ball(CONFIG.ball.radius)
      .setDensity(CONFIG.ball.density)
      .setRestitution(CONFIG.ball.restitution)
      .setFriction(CONFIG.ball.friction);
    const collider = this.world.createCollider(desc, body);
    return { body, collider };
  }

  /** An empty position-controlled kinematic body (rotor hub, gate carrier…). */
  createKinematic(pos = { x: 0, y: 0, z: 0 }) {
    return this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y, pos.z),
    );
  }

  /** Attach a cuboid collider to an existing body at a local transform. */
  attachCuboid(body, hx, hy, hz, pos = { x: 0, y: 0, z: 0 }, quat, opts = {}) {
    const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
      .setTranslation(pos.x, pos.y, pos.z)
      .setFriction(opts.friction ?? 0.45)
      .setRestitution(opts.restitution ?? 0.2);
    if (quat) desc.setRotation(quat);
    return this.world.createCollider(desc, body);
  }

  /** Attach a cylinder collider (axis along local Y) to an existing body. */
  attachCylinder(body, halfHeight, radius, pos = { x: 0, y: 0, z: 0 }, quat, opts = {}) {
    const desc = RAPIER.ColliderDesc.cylinder(halfHeight, radius)
      .setTranslation(pos.x, pos.y, pos.z)
      .setFriction(opts.friction ?? 0.4)
      .setRestitution(opts.restitution ?? 0.15);
    if (quat) desc.setRotation(quat);
    return this.world.createCollider(desc, body);
  }

  /** Attach a capsule collider (axis along local Y) to an existing body. */
  attachCapsule(body, halfHeight, radius, pos = { x: 0, y: 0, z: 0 }, quat, opts = {}) {
    const desc = RAPIER.ColliderDesc.capsule(halfHeight, radius)
      .setTranslation(pos.x, pos.y, pos.z)
      .setFriction(opts.friction ?? 0.35)
      .setRestitution(opts.restitution ?? 0.35);
    if (quat) desc.setRotation(quat);
    return this.world.createCollider(desc, body);
  }

  /** A fixed cylinder collider (axis along Y) — used as the throat gate plug. */
  addCylinder(halfHeight, radius, pos, opts = {}) {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cylinder(halfHeight, radius)
        .setFriction(opts.friction ?? 0.3)
        .setRestitution(opts.restitution ?? 0.15),
      body,
    );
    return { body, collider };
  }

  removeBody(body) {
    if (body) this.world.removeRigidBody(body);
  }

  /** Toggle all colliders of a body between solid and pass-through (sensor). */
  setColliderSolid(body, solid) {
    const n = body.numColliders();
    for (let i = 0; i < n; i++) {
      let c = body.collider(i);
      if (c != null && typeof c.setSensor !== 'function') c = this.world.getCollider(c);
      c?.setSensor?.(!solid);
    }
  }

  /** A cuboid box collider (rail dividers / gate door). */
  addBox(hx, hy, hz, pos, quat) {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z),
    );
    if (quat) body.setRotation(quat, false);
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz).setFriction(0.5).setRestitution(0.2),
      body,
    );
    return { body, collider };
  }

  removeCollider(collider) {
    if (collider) this.world.removeCollider(collider, true);
  }

  step(dt) {
    // Sub-step for stability with fast small bodies; clamp huge frame gaps.
    const clamped = Math.min(dt, CONFIG.physics.maxDt);
    const n = CONFIG.physics.subSteps;
    this.world.timestep = clamped / n;
    for (let i = 0; i < n; i++) this.world.step();
  }
}
