/**
 * Per-game studio branding — part of the 3D scene, not the UI. Two large, muted
 * vertical banners stand behind the drum on either side (seen on wide/desktop
 * frames); on narrow/portrait frames those fall off the sides, so instead a soft,
 * translucent lottery wordmark is inlaid into the studio FLOOR in front of the
 * machine, near the button. Both are rebuilt (texture only) when the game changes,
 * and which set is shown follows the viewport (landscape → banners, portrait →
 * floor). Nothing here touches the drum, the camera, physics or the UI.
 */
import * as THREE from 'three';
import { CONFIG } from '../config.js';

/** Derive a clean wordmark ("EUROJACKPOT", "NORSK LOTTO") from a profile label like
 *  "Eurojackpot (5/50 + 2/12)" or "Norsk Lotto — 7/34 + 1 tilleggstall". */
function brandOf(label) {
  return (String(label || '')
    .split(/[(—]/)[0]        // drop the "(5/50 …)" or "— 7/34 …" descriptor
    .replace(/[\d/].*$/, '') // drop any trailing numbers/ratios
    .trim()
    .toUpperCase()) || 'LOTO';
}

function bannerTexture(brand, accent) {
  const w = 340, h = 900;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  // Muted translucent panel with a soft vertical sheen.
  const grad = g.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, 'rgba(18,26,46,0.0)');
  grad.addColorStop(0.5, 'rgba(26,38,66,0.62)');
  grad.addColorStop(1, 'rgba(18,26,46,0.0)');
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  // Thin accent bars top and bottom.
  g.fillStyle = accent; g.globalAlpha = 0.5;
  g.fillRect(w * 0.2, 70, w * 0.6, 6); g.fillRect(w * 0.2, h - 76, w * 0.6, 6);
  g.globalAlpha = 1;
  // Vertical wordmark (reads bottom → top).
  g.save(); g.translate(w / 2, h / 2); g.rotate(-Math.PI / 2);
  g.font = '700 108px Inter, Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(206,220,245,0.9)';
  g.shadowColor = accent; g.shadowBlur = 26;
  const label = brand.length > 12 ? brand.replace(/\s+/g, '\n') : brand;
  label.split('\n').forEach((line, i, a) => g.fillText(line, 0, (i - (a.length - 1) / 2) * 120));
  g.restore();
  const tex = new THREE.CanvasTexture(c); tex.anisotropy = 4; tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function floorTexture(brand, accent) {
  const w = 1200, h = 300;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.font = '800 168px Inter, Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  // Soft glow pass + crisp core, both partly transparent (~25% ink) so it reads as
  // a lit inlay in the floor rather than a solid label.
  const maxW = w * 0.8; // keep side margins so any wordmark length fits the plane
  g.shadowColor = accent; g.shadowBlur = 40;
  g.fillStyle = 'rgba(226,206,140,0.55)'; g.fillText(brand, w / 2, h / 2 + 6, maxW);
  g.shadowBlur = 0;
  g.fillStyle = 'rgba(240,230,190,0.5)'; g.fillText(brand, w / 2, h / 2 + 6, maxW);
  const tex = new THREE.CanvasTexture(c); tex.anisotropy = 4; tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class StudioBranding {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.portrait = false;
    this.brand = null;
    this._bannerTex = null; this._floorTex = null;
    this._build();
  }

  _build() {
    // ── Side banners (desktop) ── behind the drum, angled in, well clear of it.
    this.banners = [];
    for (const side of [-1, 1]) {
      const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 9.2), mat);
      mesh.position.set(side * 7.6, 1.1, -5.5);
      mesh.rotation.y = -side * 0.4; // face toward the centre/camera
      this.group.add(mesh);
      this.banners.push(mesh);
    }
    // ── Floor wordmark (mobile) ── inlaid flat into the floor in front of the drum,
    // tilted a touch toward the camera so it stays readable from the low frontal view.
    const fmat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 0.62), fmat);
    // Sits on the studio apron just in front of / below the tray — the strip that
    // reads as "floor near the button" in the tight portrait frame — tilted up
    // toward the low frontal camera so the wordmark stays readable (not behind glass).
    this.floor.rotation.x = -Math.PI / 2 + 0.7;
    this.floor.position.set(0, -CONFIG.drum.radius + 0.16, 5.05);
    this.group.add(this.floor);

    this.setLayout(this.portrait);
  }

  /** Swap the wordmark textures for the given game profile. */
  setGame(profile) {
    const brand = brandOf(profile?.label);
    if (brand === this.brand) return;
    this.brand = brand;
    const accent = '#caa85f';
    this._bannerTex?.dispose();
    this._bannerTex = bannerTexture(brand, accent);
    for (const b of this.banners) { b.material.map = this._bannerTex; b.material.needsUpdate = true; }
    this._floorTex?.dispose();
    this._floorTex = floorTexture(brand, accent);
    this.floor.material.map = this._floorTex; this.floor.material.needsUpdate = true;
  }

  /** Show banners on landscape/desktop, the floor wordmark on portrait/mobile. */
  setLayout(portrait) {
    this.portrait = portrait;
    for (const b of this.banners) b.visible = !portrait;
    this.floor.visible = portrait;
  }
}
