/**
 * Per-game studio branding — part of the 3D scene, not the UI. Two large, muted
 * vertical banners stand behind the drum on either side, seen only on wide/desktop
 * (landscape) frames. On mobile/portrait NO decorative game name appears anywhere
 * in the scene (the player already picked the game in settings, and the tray must
 * stay clean): the banners are simply hidden and there is no floor/tray wordmark.
 * Nothing here touches the drum, the camera, physics or the UI.
 */
import * as THREE from 'three';

/** Derive a clean wordmark ("EUROJACKPOT", "NORSK LOTTO") from a profile label like
 *  "Eurojackpot (5/50 + 2)" or "Norsk Lotto — 7/34 + 1 tilleggstall". */
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
  // Vertical wordmark (reads bottom → top). Long names wrap to two lines.
  g.save(); g.translate(w / 2, h / 2); g.rotate(-Math.PI / 2);
  g.font = '700 104px Inter, Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(206,220,245,0.9)';
  g.shadowColor = accent; g.shadowBlur = 26;
  const label = brand.length > 12 ? brand.replace(/\s+/g, '\n') : brand;
  const lines = label.split('\n');
  lines.forEach((line, i) => g.fillText(line, 0, (i - (lines.length - 1) / 2) * 118, h * 0.82));
  g.restore();
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
    this._bannerTex = null;
    this._build();
  }

  _build() {
    // ── Side banners (desktop only) ── behind the drum, angled in, well clear of it.
    // They never overlap the drum, results, tray or settings, and are hidden on mobile.
    this.banners = [];
    for (const side of [-1, 1]) {
      const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 9.2), mat);
      mesh.position.set(side * 7.6, 1.1, -5.5);
      mesh.rotation.y = -side * 0.4; // face toward the centre/camera
      this.group.add(mesh);
      this.banners.push(mesh);
    }
    this.setLayout(this.portrait);
  }

  /** Swap the banner wordmark for the given game profile (all 9 games supported). */
  setGame(profile) {
    const brand = brandOf(profile?.label);
    if (brand === this.brand) return;
    this.brand = brand;
    this._bannerTex?.dispose();
    this._bannerTex = bannerTexture(brand, '#caa85f');
    for (const b of this.banners) { b.material.map = this._bannerTex; b.material.needsUpdate = true; }
  }

  /** Banners on landscape/desktop only; nothing in the scene on portrait/mobile. */
  setLayout(portrait) {
    this.portrait = portrait;
    for (const b of this.banners) b.visible = !portrait;
  }
}
