/**
 * Adaptive quality manager.
 *
 * Picks an initial preset from a quick device probe, then watches the rolling
 * FPS and steps the preset up/down so the demo holds ~60fps on strong devices
 * and stays smooth on weak ones. Consumers subscribe to `onChange`.
 */
import { CONFIG } from '../config.js';

export class QualityManager {
  constructor() {
    this.presets = CONFIG.quality.presets;
    this.order = CONFIG.quality.order;
    this.level = this._probe();
    this.listeners = new Set();
    this._acc = 0;
    this._fpsSum = 0;
    this._fpsN = 0;
    this.locked = false; // user can pin a preset from Settings
  }

  get preset() { return this.presets[this.level]; }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit() { for (const fn of this.listeners) fn(this.preset, this.level); }

  /** Rough starting tier from device hints (no benchmark stalls). */
  _probe() {
    const dpr = window.devicePixelRatio || 1;
    const mobile = /iPhone|Android|iPad|iPod/i.test(navigator.userAgent) ||
      (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
    const mem = navigator.deviceMemory || (mobile ? 4 : 8);
    const cores = navigator.hardwareConcurrency || (mobile ? 4 : 8);
    if (!mobile && mem >= 8 && cores >= 8) return 'ultra';
    if (mem >= 6 && cores >= 6) return 'high';
    if (mem >= 4) return 'medium';
    return 'low';
    void dpr;
  }

  setLevel(level) {
    if (!this.presets[level] || level === this.level) return;
    this.level = level;
    this._emit();
  }

  lock(level) {
    this.locked = true;
    this.setLevel(level);
  }
  unlock() { this.locked = false; }

  /** Feed the current fps each frame; may trigger a step change. */
  sample(fps, dt) {
    if (this.locked) return;
    this._fpsSum += fps; this._fpsN++;
    this._acc += dt;
    if (this._acc < CONFIG.quality.sampleSeconds) return;
    const avg = this._fpsSum / Math.max(1, this._fpsN);
    this._acc = 0; this._fpsSum = 0; this._fpsN = 0;
    const i = this.order.indexOf(this.level);
    if (avg < CONFIG.quality.downgradeBelowFps && i < this.order.length - 1) {
      this.setLevel(this.order[i + 1]);
    } else if (avg > CONFIG.quality.upgradeAboveFps && i > 0) {
      this.setLevel(this.order[i - 1]);
    }
  }
}
