/**
 * Lightweight frame-time / FPS meter with a rolling average, used both for the
 * HUD readout and for the adaptive quality manager.
 */
export class FrameStats {
  constructor(windowSize = 90) {
    this.windowSize = windowSize;
    this.samples = new Float32Array(windowSize);
    this.index = 0;
    this.count = 0;
    this.last = performance.now();
    this.fps = 60;
    this.frameMs = 16.7;
  }

  /** Call once per rendered frame; returns clamped dt in seconds. */
  tick() {
    const now = performance.now();
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt <= 0 || dt > 0.5) dt = 1 / 60; // tab was hidden / first frame
    this.frameMs = dt * 1000;
    this.samples[this.index] = dt;
    this.index = (this.index + 1) % this.windowSize;
    this.count = Math.min(this.count + 1, this.windowSize);
    let sum = 0;
    for (let i = 0; i < this.count; i++) sum += this.samples[i];
    this.fps = this.count ? this.count / sum : 60;
    return dt;
  }
}
