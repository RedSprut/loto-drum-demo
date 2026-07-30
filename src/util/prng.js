/**
 * Randomness helpers.
 *
 * Fairness note: the draw result is emergent from the physics simulation, not
 * from any pre-computed sequence. To make the *initial* chaotic state genuinely
 * unpredictable we seed it from crypto entropy; the turbulence field then keeps
 * evolving it. Nobody — including this code — knows the winner before a ball
 * physically crosses the exit plane.
 */

/** Cryptographically strong float in [0,1). */
export function secureRandom() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 4294967296;
}

/** Random float in [min,max). */
export function range(min, max) {
  return min + secureRandom() * (max - min);
}

/**
 * Cheap, smooth 3D value noise used for the turbulent air field. This is only
 * a *force field* — it perturbs bodies, it never decides the outcome. A fixed
 * hash keeps the field spatially coherent frame-to-frame while a time input
 * animates it.
 */
export function makeNoise3() {
  const hash = (x, y, z) => {
    let h = x * 374761393 + y * 668265263 + z * 2147483647;
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const lerp = (a, b, t) => a + (b - a) * t;
  const fade = (t) => t * t * (3 - 2 * t);
  return (x, y, z) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = fade(xf), v = fade(yf), w = fade(zf);
    const c000 = hash(xi, yi, zi), c100 = hash(xi + 1, yi, zi);
    const c010 = hash(xi, yi + 1, zi), c110 = hash(xi + 1, yi + 1, zi);
    const c001 = hash(xi, yi, zi + 1), c101 = hash(xi + 1, yi, zi + 1);
    const c011 = hash(xi, yi + 1, zi + 1), c111 = hash(xi + 1, yi + 1, zi + 1);
    const x00 = lerp(c000, c100, u), x10 = lerp(c010, c110, u);
    const x01 = lerp(c001, c101, u), x11 = lerp(c011, c111, u);
    const y0 = lerp(x00, x10, v), y1 = lerp(x01, x11, v);
    return lerp(y0, y1, w) * 2 - 1; // [-1,1]
  };
}
