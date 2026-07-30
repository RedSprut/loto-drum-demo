/**
 * The transparent spherical chamber and its supporting machine.
 *
 * Unlike a vertical air-mix canister, this is a professional gravity-mix drum:
 * a near-spherical glass sphere held on a horizontal axis in a metal frame, with
 * a small exit throat at the bottom. The chamber itself is STATIC — the mixing
 * is done by the internal rotor (see rotor.js). The inner glass surface is
 * mirrored by a fixed Rapier trimesh so balls physically bounce off the sphere.
 *
 * A cylindrical gate plug fills the throat while mixing; opening it lets exactly
 * one ball drop into the capture cup below.
 */
import * as THREE from 'three';
import { CONFIG } from '../config.js';

/**
 * Triangulate the inner sphere as a UV mesh from the north pole down to just
 * above the south pole, leaving a circular hole (the throat) at the bottom.
 * Returns flat arrays suitable for a Rapier trimesh and a Three BufferGeometry.
 */
function sphereShell(radius, latRings, lonSegs, holeAngle) {
  // phi runs 0 (north, +Y) → PI-holeAngle (just before the south pole hole).
  const phiMax = Math.PI - holeAngle;
  const verts = [];
  for (let i = 0; i <= latRings; i++) {
    const phi = (i / latRings) * phiMax;
    const y = Math.cos(phi) * radius;
    const rr = Math.sin(phi) * radius;
    for (let j = 0; j <= lonSegs; j++) {
      const theta = (j / lonSegs) * Math.PI * 2;
      verts.push(Math.cos(theta) * rr, y, Math.sin(theta) * rr);
    }
  }
  const idx = [];
  const stride = lonSegs + 1;
  for (let i = 0; i < latRings; i++) {
    for (let j = 0; j < lonSegs; j++) {
      const a = i * stride + j;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      // Wind so normals face inward (balls live inside).
      idx.push(a, b, c, b, d, c);
    }
  }
  return { vertices: new Float32Array(verts), indices: new Uint32Array(idx) };
}

export class Drum {
  constructor(scene, physics) {
    this.scene = scene;
    this.physics = physics;
    this.gateOpen = false;
    this._build();
  }

  _build() {
    const D = CONFIG.drum;
    const C = CONFIG.colors;
    const R = D.radius;
    const holeAngle = Math.asin(Math.min(0.9, D.throatRadius / R));

    // ── Materials ──
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0.0,
      roughness: 0.03,
      transmission: 1.0,
      thickness: 0.6,
      ior: 1.49,               // cast acrylic
      transparent: true,
      opacity: 0.42,
      clearcoat: 1.0,
      clearcoatRoughness: 0.03,
      iridescence: 0.16,       // faint edge sheen like real thick acrylic
      iridescenceIOR: 1.3,
      specularIntensity: 1.0,
      envMapIntensity: 1.5,
      attenuationColor: new THREE.Color(0xdff0ff),
      attenuationDistance: 6.0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const silver = new THREE.MeshStandardMaterial({ color: C.silver, metalness: 0.9, roughness: 0.24, envMapIntensity: 1.2 });
    const graphite = new THREE.MeshStandardMaterial({ color: C.graphite, metalness: 0.7, roughness: 0.4, envMapIntensity: 0.9 });
    const gold = new THREE.MeshStandardMaterial({ color: C.gold, metalness: 0.95, roughness: 0.3, envMapIntensity: 1.1, emissive: 0x1a1203, emissiveIntensity: 0.12 });
    this._silver = silver; this._graphite = graphite; this._gold = gold;

    // ── Visual glass sphere (slightly stretched horizontally for the silhouette) ──
    const glassGeo = new THREE.SphereGeometry(D.glassOuter, D.visSegments, D.visSegments * 0.6, 0, Math.PI * 2, 0, Math.PI - holeAngle);
    const glassMesh = new THREE.Mesh(glassGeo, glass);
    glassMesh.scale.x = D.equatorScaleX;
    glassMesh.renderOrder = 3;
    // A faint inner shell adds a believable double-wall thickness.
    const innerGeo = new THREE.SphereGeometry(R + 0.02, D.visSegments, D.visSegments * 0.6, 0, Math.PI * 2, 0, Math.PI - holeAngle);
    const innerMesh = new THREE.Mesh(innerGeo, glass);
    innerMesh.scale.x = D.equatorScaleX;
    innerMesh.renderOrder = 2;

    this.group = new THREE.Group();
    this.group.add(glassMesh, innerMesh);

    // Equator ring (thin gold accent) + a satin band just below it.
    const eqRing = new THREE.Mesh(new THREE.TorusGeometry(D.glassOuter * D.equatorScaleX, 0.05, 20, 96), gold);
    eqRing.rotation.x = Math.PI / 2;
    this.group.add(eqRing);

    // Throat funnel at the bottom (metal collar around the hole).
    const funnel = new THREE.Mesh(
      new THREE.CylinderGeometry(D.throatRadius + 0.06, D.throatRadius + 0.02, 0.22, 40, 1, true),
      silver,
    );
    funnel.position.y = -R + 0.02;
    this.group.add(funnel);

    this.scene.add(this.group);

    // ── Metal frame: side pilons + bearing housings + horizontal axle ──
    const frame = new THREE.Group();
    const axleY = 0;
    const halfSpan = R * D.equatorScaleX + 0.55;
    for (const sx of [-1, 1]) {
      // Pilon post (slim, rounded — capsule reads less like a wooden beam).
      const post = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, R * 1.7, 6, 16), graphite);
      post.position.set(sx * halfSpan, axleY - 0.4, 0);
      post.castShadow = true;
      // Bearing housing where the axle meets the pilon.
      const bearing = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.34, 28), silver);
      bearing.rotation.z = Math.PI / 2;
      bearing.position.set(sx * (halfSpan - 0.1), axleY, 0);
      // Axial mount stub reaching from the bearing to the glass.
      const stub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.7, 20), silver);
      stub.rotation.z = Math.PI / 2;
      stub.position.set(sx * (halfSpan - 0.55), axleY, 0);
      frame.add(post, bearing, stub);
    }

    // Rear motor housing.
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 1.0, 24), graphite);
    motor.rotation.x = Math.PI / 2;
    motor.position.set(halfSpan, axleY, -0.9);
    frame.add(motor);

    // Base cross-beam tying the two pilons together.
    const beam = new THREE.Mesh(new THREE.BoxGeometry(halfSpan * 2 + 0.4, 0.3, 0.7), graphite);
    beam.position.set(0, axleY - R * 0.95 - 0.2, 0);
    beam.receiveShadow = true;
    frame.add(beam);

    this.scene.add(frame);
    this.frame = frame;

    // ── Physics: fixed sphere wall with the throat hole ──
    const { vertices, indices } = sphereShell(R, D.latRings, D.lonSegs, holeAngle);
    const wall = this.physics.addTrimesh(vertices, indices, { friction: 0.35, restitution: 0.28 });
    this.wallBody = wall.body;

    // Gate plug closed by default.
    this._gate = null;
    this.closeGate();
  }

  openGate() {
    if (this.gateOpen) return;
    if (this._gate) { this.physics.removeBody(this._gate.body); this._gate = null; }
    this.gateOpen = true;
  }

  closeGate() {
    if (this._gate) return;
    const D = CONFIG.drum;
    this._gate = this.physics.addCylinder(0.05, D.throatRadius + 0.02, { x: 0, y: D.gateY, z: 0 }, { restitution: 0.2 });
    this.gateOpen = false;
  }

  update() { /* chamber is static; mixing is done by the rotor */ }
}
