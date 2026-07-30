/**
 * The TV studio the machine stands in: a soft graphite-blue backdrop arc with a
 * glowing halo and vertical light strips, a semi-reflective floor, a low premium
 * pedestal under the drum, and a grounding contact shadow. Kept cheap — no extra
 * render targets beyond the renderer's shared environment map.
 */
import * as THREE from 'three';
import { CONFIG } from '../config.js';

export function buildStudio(scene) {
  const C = CONFIG.colors;
  const floorY = -CONFIG.drum.radius - 1.4;
  const pedTop = -CONFIG.drum.radius - 0.2; // just below the sphere's bottom

  // ── Backdrop: large gradient dome ──
  const domeMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(C.backgroundTop) },
      bottom: { value: new THREE.Color(C.backgroundBottom) },
    },
    vertexShader: `varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vPos; uniform vec3 top; uniform vec3 bottom;
      void main(){ float h = clamp(vPos.y/60.0*0.5+0.5, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, pow(h,1.3)), 1.0); }`,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(60, 32, 16), domeMat));

  // ── Backdrop halo behind the machine ──
  const halo = new THREE.Mesh(
    new THREE.CircleGeometry(9, 64),
    new THREE.MeshBasicMaterial({ color: 0x22335c, transparent: true, opacity: 0.55 }),
  );
  halo.position.set(0, 0.5, -14);
  scene.add(halo);
  const halo2 = new THREE.Mesh(
    new THREE.RingGeometry(9, 9.5, 64),
    new THREE.MeshBasicMaterial({ color: C.gold, transparent: true, opacity: 0.35 }),
  );
  halo2.position.set(0, 0.5, -13.9);
  scene.add(halo2);

  // ── Vertical light strips on the backdrop ──
  const stripMat = new THREE.MeshBasicMaterial({ color: 0x3d63b8, transparent: true, opacity: 0.5 });
  for (const x of [-11, -8, 8, 11]) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 20), stripMat);
    strip.position.set(x, 1, -13);
    scene.add(strip);
  }

  // ── Floor (semi-reflective, not a mirror) ──
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(40, 96),
    new THREE.MeshStandardMaterial({ color: 0x090d16, metalness: 0.12, roughness: 0.58, envMapIntensity: 0.55 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = floorY;
  floor.receiveShadow = true;
  scene.add(floor);

  // ── Pedestal: a machined black-anodized column with a brushed-aluminium collar
  //    and a thin recessed gold LED ring. Top sits just below the sphere. ──
  const ped = new THREE.Group();
  const pedH = pedTop - floorY;
  const anodized = new THREE.MeshStandardMaterial({ color: 0x14181f, metalness: 0.75, roughness: 0.42, envMapIntensity: 0.8 });
  const brushed = new THREE.MeshStandardMaterial({ color: 0x9aa2ae, metalness: 0.92, roughness: 0.52, envMapIntensity: 0.85 });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 3.15, pedH * 0.8, 72), anodized);
  body.position.y = floorY + pedH * 0.4;
  body.receiveShadow = true; body.castShadow = true;
  // Brushed-aluminium collar (machined step) near the top.
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(2.62, 2.62, pedH * 0.22, 72), brushed);
  collar.position.y = pedTop - pedH * 0.11 - 0.02;
  const capRing = new THREE.Mesh(new THREE.CylinderGeometry(2.66, 2.66, 0.06, 72), brushed);
  capRing.position.y = pedTop - 0.02;
  // Thin recessed gold LED ring (subtle, not a lamp).
  const led = new THREE.Mesh(
    new THREE.TorusGeometry(2.63, 0.03, 12, 96),
    new THREE.MeshStandardMaterial({ color: C.gold, emissive: C.gold, emissiveIntensity: 0.35, metalness: 0.4, roughness: 0.5 }),
  );
  led.rotation.x = Math.PI / 2; led.position.y = pedTop - pedH * 0.22 - 0.02;
  ped.scale.x = 1.08; // gentle oval
  ped.add(body, collar, capRing, led);
  scene.add(ped);

  // ── Contact shadow disc ──
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(4.2, 64),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32 }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = floorY + 0.02;
  scene.add(shadow);
}
