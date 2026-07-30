/**
 * Three.js rendering stack: WebGL2 renderer, camera, HDR-ish studio lighting,
 * shadows, an image-based environment for the glass reflections, and a bloom
 * post-processing chain with ACES filmic tone mapping. Quality-preset aware.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CONFIG } from '../config.js';

export class RenderEngine {
  constructor(canvas, preset) {
    this.canvas = canvas;
    this.preset = preset;

    // preserveDrawingBuffer is needed only for the offline screenshot/benchmark
    // harness (so a captured frame isn't an empty swapped buffer). It carries a
    // small perf cost, so it's off for the normal interactive demo.
    const harness = /[?&](shot|bench)=/.test(location.search);
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: preset.msaa > 0,
      powerPreference: 'high-performance',
      stencil: false,
      preserveDrawingBuffer: harness,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.78;
    this.renderer.shadowMap.enabled = preset.shadow > 0;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(CONFIG.colors.backgroundBottom);
    this.scene.fog = new THREE.FogExp2(CONFIG.colors.backgroundBottom, 0.012);

    const cam = CONFIG.camera;
    this.camera = new THREE.PerspectiveCamera(cam.fov, 1, cam.near, cam.far);
    this.camera.position.set(...cam.shots.MAIN.pos);
    this.camera.lookAt(...cam.shots.MAIN.target);

    this._buildLights();
    this._buildEnvironment(preset.env);
    this._buildComposer(preset);

    this.resize();
  }

  _buildLights() {
    const C = CONFIG.colors;
    // Key: warm soft light from upper-left, casts the shadows.
    const key = new THREE.DirectionalLight(C.warmLight, 2.6);
    key.position.set(-9, 12, 9);
    key.castShadow = this.preset.shadow > 0;
    key.shadow.mapSize.set(this.preset.shadow || 1024, this.preset.shadow || 1024);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 40;
    key.shadow.camera.left = -7; key.shadow.camera.right = 7;
    key.shadow.camera.top = 7; key.shadow.camera.bottom = -7;
    key.shadow.bias = -0.0005;
    key.shadow.radius = 5;
    this.keyLight = key;
    this.scene.add(key, key.target);

    // Fill: cool light from the right.
    const fill = new THREE.DirectionalLight(C.coolLight, 1.2);
    fill.position.set(10, 5, 7);
    this.scene.add(fill);

    // Rim: cool backlight behind the sphere to pop the silhouette.
    const rim = new THREE.DirectionalLight(0x9eb7ff, 2.0);
    rim.position.set(0, 6, -12);
    this.scene.add(rim);

    // Warm gold rim from the lower-right for a premium broadcast edge.
    const goldRim = new THREE.DirectionalLight(C.gold, 1.1);
    goldRim.position.set(7, -3, -6);
    this.scene.add(goldRim);

    // Soft warm accent on the chute / rack at the front (small, no hotspot).
    const accent = new THREE.PointLight(C.warmLight, 6, 10, 2.4);
    accent.position.set(0, -0.8, 6.2);
    this.scene.add(accent);

    this.scene.add(new THREE.AmbientLight(0x2a3350, 0.5));
  }

  _buildEnvironment(size) {
    // Fast, dependency-free image-based lighting: paint a studio equirectangular
    // gradient with a few soft "softbox" highlights on a canvas, then prefilter
    // it with PMREM.fromEquirectangular (much lighter than rendering a room
    // scene, and robust on every GPU including software renderers).
    const tex = studioEquirectangular(size * 2);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    const env = pmrem.fromEquirectangular(tex);
    this.scene.environment = env.texture;
    tex.dispose();
    this._pmrem = pmrem;
    this._envRT = env;
  }

  _buildComposer(preset) {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Very restrained bloom — only genuinely hot highlights (high threshold).
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.16, 0.35, 1.1);
    this.bloom.enabled = preset.bloom;
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  /** Re-apply a quality preset at runtime. */
  applyPreset(preset) {
    this.preset = preset;
    const useShadow = preset.shadow > 0;
    this.renderer.shadowMap.enabled = useShadow;
    this.keyLight.castShadow = useShadow;
    if (useShadow) this.keyLight.shadow.mapSize.set(preset.shadow, preset.shadow);
    this.keyLight.shadow.map?.dispose();
    this.keyLight.shadow.map = null;
    this.bloom.enabled = preset.bloom;
    this.resize();
  }

  resize() {
    // Prefer the visual viewport (correct on iOS Safari as the toolbar shows/hides).
    const vv = window.visualViewport;
    const w = Math.round((vv && vv.width) || this.canvas.clientWidth || window.innerWidth);
    const h = Math.round((vv && vv.height) || this.canvas.clientHeight || window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, this.preset.dpr);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, true); // update CSS too so buffer + element match
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render() {
    if (this.bloom.enabled) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}

/** Procedural studio HDRi-style equirectangular texture (no external assets). */
function studioEquirectangular(w) {
  const h = Math.max(2, Math.floor(w / 2));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');

  // Vertical studio gradient: bright ceiling → neutral horizon → dark floor.
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0.0, '#eef2ff');
  grad.addColorStop(0.35, '#7c88ad');
  grad.addColorStop(0.55, '#2b3350');
  grad.addColorStop(1.0, '#05060c');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);

  // Soft rectangular softboxes for crisp glass/metal highlights.
  const softbox = (cx, cy, rw, rh, a) => {
    const rg = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rw, rh));
    rg.addColorStop(0, `rgba(255,255,255,${a})`);
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.save(); g.translate(cx, cy); g.scale(rw / Math.max(rw, rh), rh / Math.max(rw, rh));
    g.fillStyle = rg; g.beginPath();
    g.arc(0, 0, Math.max(rw, rh), 0, Math.PI * 2); g.fill(); g.restore();
  };
  softbox(w * 0.22, h * 0.24, w * 0.10, h * 0.16, 0.9);
  softbox(w * 0.70, h * 0.20, w * 0.13, h * 0.12, 0.8);
  softbox(w * 0.50, h * 0.30, w * 0.06, h * 0.10, 0.6);
  // Warm accent near the horizon for a premium tint.
  const warm = g.createRadialGradient(w * 0.85, h * 0.45, 0, w * 0.85, h * 0.45, w * 0.2);
  warm.addColorStop(0, 'rgba(255,170,90,0.35)');
  warm.addColorStop(1, 'rgba(255,170,90,0)');
  g.fillStyle = warm; g.fillRect(0, 0, w, h);

  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
