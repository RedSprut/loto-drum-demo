/**
 * Drum theming — one system, driven by the canonical per-game palette
 * (registry.js GAME_THEMES, which mirrors the main app's body[data-game] tokens).
 * Standalone: the theme comes from the game's registry tokens. Embedded: the app
 * passes its live tokens as URL params which override them, so the 3D screen always
 * matches the game the user picked in the app. Applied as CSS custom properties so
 * the DOM chrome (header, button, chips, accents) themes with zero duplication.
 */
import { themeOf } from '../registry.js';

// URL param name → theme token (the app passes these when embedding).
const PARAM_MAP = { primary: 'hdrA', secondary: 'hdrB', accent: 'hdrC', glow: 'glow', ballMain: 'gm', ballBonus: 'gb' };

/** Resolve a game's theme, letting URL params override the registry defaults. */
export function resolveTheme(profileId, params) {
  const base = { ...themeOf(profileId) };
  if (params) {
    for (const [token, param] of Object.entries(PARAM_MAP)) {
      const v = (params.get(param) || '').trim();
      if (v) base[token] = v;
    }
  }
  return base;
}

/** Push a theme to the document as CSS custom properties. */
export function applyTheme(theme, root = document.documentElement) {
  root.style.setProperty('--g-primary', theme.primary);
  root.style.setProperty('--g-secondary', theme.secondary);
  root.style.setProperty('--g-accent', theme.accent);
  root.style.setProperty('--g-glow', theme.glow);
  root.style.setProperty('--g-ball-main', theme.ballMain);
  root.style.setProperty('--g-ball-bonus', theme.ballBonus);
}
