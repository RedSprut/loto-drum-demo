/**
 * Paints a lottery-ball texture on a 2:1 equirectangular canvas. The number is
 * printed on SIX ivory medallions (four around the equator + two near the poles)
 * so the digit stays readable no matter how the ball tumbles on the rotor. The
 * ball's base colour fills the rest. Textures are cached by number+colour.
 */
import * as THREE from 'three';

const CACHE = new Map();

function hex(n) { return `#${(n >>> 0).toString(16).padStart(6, '0').slice(-6)}`; }

function medallion(g, cx, cy, r, label) {
  // Ivory disc.
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fillStyle = '#f7f0dd'; g.fill();
  // Dark ring.
  g.lineWidth = r * 0.11; g.strokeStyle = '#2a2b31'; g.stroke();
  // Digit.
  g.fillStyle = '#18191d';
  g.font = `700 ${Math.round(r * 1.05)}px "Helvetica Neue", Arial, system-ui, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(label, cx, cy + r * 0.04);
}

export function ballTexture(value, color) {
  const key = `${value}:${color}`;
  if (CACHE.has(key)) return CACHE.get(key);

  const W = 1024, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');

  // Base coat: the ball colour with a subtle vertical shade for volume.
  const base = new THREE.Color(color);
  const dark = base.clone().multiplyScalar(0.72);
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, hex(dark.getHex()));
  grad.addColorStop(0.5, hex(base.getHex()));
  grad.addColorStop(1, hex(dark.getHex()));
  g.fillStyle = grad; g.fillRect(0, 0, W, H);

  const label = String(value);
  const rEq = H * 0.17;
  // Four medallions around the equator (avoid the u=0 seam).
  for (const u of [0.125, 0.375, 0.625, 0.875]) medallion(g, u * W, H * 0.5, rEq, label);
  // Two smaller medallions toward the poles.
  medallion(g, W * 0.5, H * 0.16, rEq * 0.82, label);
  medallion(g, W * 0.5, H * 0.84, rEq * 0.82, label);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  CACHE.set(key, tex);
  return tex;
}
