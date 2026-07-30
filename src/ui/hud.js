/**
 * Heads-up UI (Russian). The machine is the hero: a primary button (bottom
 * centre), a data-driven results row (top centre, one labelled group per pool),
 * and a compact settings gear (bottom right) with a temporary game-profile
 * selector + quality + reset. Diagnostic meters appear only with ?debug=1.
 * The HUD owns no simulation logic — it reads state and emits intents.
 */
import { State } from '../sim/draw.js';
import { GAME_PROFILES } from '../games.js';

export class HUD {
  constructor(root, handlers, { debug = false, profileKey = '' } = {}) {
    this.h = handlers; // {onStart, onReset, onQuality, onProfile}
    this.root = root;
    this.debug = debug;
    this.groups = {}; // poolId → {ballsEl}
    this._build(profileKey);
  }

  _build(profileKey) {
    this.results = document.createElement('div');
    this.results.className = 'dd-results';

    this.startBtn = document.createElement('button');
    this.startBtn.className = 'dd-primary';
    this.startBtn.textContent = 'Начать розыгрыш';
    this.startBtn.onclick = () => { if (!this.startBtn.disabled) this.h.onStart?.(); };

    this.setBtn = document.createElement('button');
    this.setBtn.className = 'dd-gear';
    this.setBtn.setAttribute('aria-label', 'Настройки');
    this.setBtn.textContent = '⚙';

    this.panel = document.createElement('div');
    this.panel.className = 'dd-panel hidden';
    const profileOptions = Object.entries(GAME_PROFILES)
      .map(([k, p]) => `<option value="${k}"${k === profileKey ? ' selected' : ''}>${p.label}</option>`).join('');
    this.panel.innerHTML = `
      <h3>Настройки</h3>
      <label class="dd-row">Игра
        <select data-profile>${profileOptions}</select>
      </label>
      <label class="dd-row">Качество
        <select data-q>
          <option value="auto">Авто</option>
          <option value="ultra">Ультра</option>
          <option value="high">Высокое</option>
          <option value="medium">Среднее</option>
          <option value="low">Низкое</option>
        </select>
      </label>
      <button class="dd-reset" data-reset>Сбросить</button>
      <p class="dd-note">Победитель определяется только когда шар физически выпадает из барабана. Заранее заданной последовательности нет.</p>
    `;
    this.setBtn.onclick = () => this.panel.classList.toggle('hidden');
    this.panel.querySelector('[data-profile]').onchange = (e) => this.h.onProfile?.(e.target.value);
    this.panel.querySelector('[data-q]').onchange = (e) => this.h.onQuality?.(e.target.value);
    this.panel.querySelector('[data-reset]').onclick = () => { this.panel.classList.add('hidden'); this.h.onReset?.(); };

    this.root.append(this.results, this.startBtn, this.setBtn, this.panel);

    // Keep the result chips fitting one line as the viewport changes.
    const onResize = () => this._sizeChips();
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);

    if (this.debug) {
      this.meters = document.createElement('div');
      this.meters.className = 'dd-meters';
      this.fpsEl = document.createElement('span');
      this.physEl = document.createElement('span');
      this.stateEl = document.createElement('span');
      this.actEl = document.createElement('span');
      this.meters.append(this.fpsEl, this.physEl, this.stateEl, this.actEl);
      this.root.append(this.meters);
    }
  }

  /** Rebuild the results row for a profile: main group on its own single line,
   *  each bonus group stacked BELOW on its own line (hidden until it has balls). */
  buildLayout(profile) {
    this.results.innerHTML = '';
    this.groups = {};
    this.mainCount = profile.resultLayout.groups[0]?.slotCount || 6;
    profile.resultLayout.groups.forEach((g, i) => {
      const wrap = document.createElement('div');
      wrap.className = `dd-result-group${i > 0 ? ' bonus empty' : ''}`;
      wrap.dataset.pool = g.pool;
      const label = document.createElement('div');
      label.className = 'dd-result-group__label';
      label.textContent = g.label;
      const balls = document.createElement('div');
      balls.className = 'dd-result-group__balls';
      wrap.append(label, balls);
      this.results.appendChild(wrap);
      this.groups[g.pool] = { wrap, ballsEl: balls, bonus: i > 0 };
    });
    this._sizeChips();
  }

  /** Fill chips; bonus rows stay hidden until they actually have a ball. */
  setResults(resultsByPool) {
    for (const [poolId, group] of Object.entries(this.groups)) {
      group.ballsEl.innerHTML = '';
      const vals = resultsByPool[poolId] || [];
      for (const v of vals) {
        const chip = document.createElement('div');
        chip.className = `dd-chip pop${group.bonus ? ' bonus' : ''}`;
        chip.textContent = v;
        group.ballsEl.appendChild(chip);
      }
      if (group.bonus) group.wrap.classList.toggle('empty', vals.length === 0);
    }
  }

  /** Size the result chips so the main group always fits on ONE line. */
  _sizeChips() {
    const vw = Math.min(window.visualViewport?.width || window.innerWidth, 660);
    const n = Math.max(this.mainCount || 6, 1);
    const size = Math.max(20, Math.min(40, (vw - 40 - (n - 1) * 7) / n));
    this.results.style.setProperty('--chip', `${size.toFixed(1)}px`);
  }

  setPhase(state, winner) {
    const b = this.startBtn;
    switch (state) {
      case State.IDLE: b.textContent = 'Начать розыгрыш'; b.disabled = false; break;
      case State.STARTUP:
      case State.MIXING:
      case State.RELOAD: b.textContent = 'Перемешивание…'; b.disabled = true; break;
      case State.ARMING:
      case State.CAPTURING: b.textContent = 'Выбор шара…'; b.disabled = true; break;
      case State.TRANSIT:
      case State.DISPLAY:
      case State.STOPPING: b.textContent = winner != null ? `Шар №${winner}` : 'Выбор шара…'; b.disabled = true; break;
      case State.COMPLETE: b.textContent = 'Новый розыгрыш'; b.disabled = false; break;
      default: break;
    }
  }

  setMeters(fps, bodies, state, activity) {
    if (!this.debug) return;
    this.fpsEl.textContent = `${Math.round(fps)} FPS`;
    this.fpsEl.dataset.warn = fps < 40 ? '1' : '0';
    this.physEl.textContent = `${bodies} balls`;
    this.stateEl.textContent = String(state).toUpperCase();
    this.actEl.textContent = `mix ${Math.round(activity * 100)}%`;
    this.actEl.dataset.warn = state === State.MIXING && activity < 0.55 ? '1' : '0';
  }
}
