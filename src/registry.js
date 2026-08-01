/**
 * CANONICAL GAME REGISTRY — the single source of truth for which lotteries the
 * drum offers and their rules. These are the EXACT same 9 games the main app
 * exposes (`results.json` game IDs / `index.html` LOTTERY_CONFIG). The IDs here
 * are the main app's database IDs, so `scripts/audit-drum-games.mjs` can assert
 * `mainApplicationGameIds === drumProfileGameIds` (and matching rules) at build
 * time — the drum can never silently drift from the app again.
 *
 * Rules verified against official operators on 2026-08-01 (see GAME_RULES_AUDIT.md).
 * Ordered as the product spec lists them.
 *
 * Fields per game:
 *   id        main-app database id (results.json key)
 *   name      display name (drum settings + banners)
 *   label     dropdown label (name + compact format), never truncated
 *   country   ISO-ish region tag (informational)
 *   main      { max, draw }                       — 1..max pool, `draw` balls out
 *   bonus     { poolId, label, max, draw, strategy, colorSet } | null
 *             strategy: 'same-main-pool' (extra ball из того же барабана) |
 *                       'separate-pool'  (отдельный пул, барабан перезагружается)
 */
export const CANONICAL_GAMES = [
  { id: 'lotto', name: 'Norsk Lotto', label: 'Norsk Lotto (7/34 + 1)', country: 'NO',
    main: { max: 34, draw: 7, label: 'HOVEDTALL' },
    bonus: { poolId: 'tilleggstall', label: 'TILLEGGSTALL', max: 34, draw: 1, strategy: 'same-main-pool', colorSet: 'bonus-red' } },

  { id: 'vikinglotto', name: 'Vikinglotto', label: 'Vikinglotto (6/48 + 1)', country: 'NO',
    main: { max: 48, draw: 6, label: 'Основные' },
    bonus: { poolId: 'viking', label: 'Viking', max: 5, draw: 1, strategy: 'separate-pool', colorSet: 'bonus-red' } },

  { id: 'eurojackpot', name: 'Eurojackpot', label: 'Eurojackpot (5/50 + 2)', country: 'EU',
    main: { max: 50, draw: 5, label: 'Основные' },
    bonus: { poolId: 'euro', label: 'Euro', max: 12, draw: 2, strategy: 'separate-pool', colorSet: 'bonus-gold' } },

  { id: 'powerball', name: 'Powerball', label: 'Powerball (5/69 + 1)', country: 'US',
    main: { max: 69, draw: 5, label: 'Основные' },
    bonus: { poolId: 'power', label: 'Powerball', max: 26, draw: 1, strategy: 'separate-pool', colorSet: 'bonus-red' } },

  { id: 'megaMillions', name: 'Mega Millions', label: 'Mega Millions (5/70 + 1)', country: 'US',
    main: { max: 70, draw: 5, label: 'Основные' },
    bonus: { poolId: 'mega', label: 'Mega', max: 24, draw: 1, strategy: 'separate-pool', colorSet: 'bonus-gold' } },

  { id: 'euroMillions', name: 'EuroMillions', label: 'EuroMillions (5/50 + 2)', country: 'EU',
    main: { max: 50, draw: 5, label: 'Основные' },
    bonus: { poolId: 'stars', label: 'Звёзды', max: 12, draw: 2, strategy: 'separate-pool', colorSet: 'bonus-gold' } },

  { id: 'superEnalotto', name: 'SuperEnalotto', label: 'SuperEnalotto (6/90 + Jolly)', country: 'IT',
    main: { max: 90, draw: 6, label: 'Основные' },
    bonus: { poolId: 'jolly', label: 'Jolly', max: 90, draw: 1, strategy: 'same-main-pool', colorSet: 'bonus-red' } },

  { id: 'lottoMax', name: 'Lotto Max', label: 'Lotto Max (7/52 + 1)', country: 'CA',
    main: { max: 52, draw: 7, label: 'Основные' },
    bonus: { poolId: 'bonus', label: 'Bonus', max: 52, draw: 1, strategy: 'same-main-pool', colorSet: 'bonus-red' } },

  { id: 'powerballAustralia', name: 'Powerball Australia', label: 'Powerball AU (7/35 + 1)', country: 'AU',
    main: { max: 35, draw: 7, label: 'Основные' },
    bonus: { poolId: 'powerAu', label: 'Powerball', max: 20, draw: 1, strategy: 'separate-pool', colorSet: 'bonus-red' } },
];

/** The canonical game IDs (order preserved) — the drum's public game set. */
export const CANONICAL_GAME_IDS = CANONICAL_GAMES.map((g) => g.id);

export const DEFAULT_GAME_ID = 'eurojackpot';

/**
 * Per-game theme tokens — the SAME palette the main app uses (index.html
 * body[data-game=…] tokens --hdr-a/-b/-c, --game-glow, --gm, --gb). Keyed by the
 * canonical game id, so the drum is themed identically whether it runs standalone
 * or embedded. When embedded, the app passes the live tokens as URL params which
 * override these (see main.js applyTheme). Each game is recognisable by its palette
 * while sharing one premium system.
 *   primary/secondary/accent → header→footer gradient + accents
 *   glow → decorative glow    ballMain/ballBonus → result-chip colours
 */
export const GAME_THEMES = {
  lotto:              { primary: '#B81B44', secondary: '#7A0E2B', accent: '#4A0919', glow: 'rgba(184,27,68,.5)',  ballMain: '#CC2060', ballBonus: '#F4F0E8' },
  vikinglotto:        { primary: '#2A4BD8', secondary: '#1E7FC8', accent: '#0FBFA6', glow: 'rgba(30,110,200,.5)', ballMain: '#2146C7', ballBonus: '#111B45' },
  eurojackpot:        { primary: '#0E7A50', secondary: '#0E4B4E', accent: '#123A44', glow: 'rgba(16,120,80,.5)',  ballMain: '#F3C316', ballBonus: '#194F90' },
  powerball:          { primary: '#B5162B', secondary: '#7A1250', accent: '#12327E', glow: 'rgba(120,30,110,.5)', ballMain: '#F6F7F8', ballBonus: '#D71E28' },
  megaMillions:       { primary: '#C09018', secondary: '#6A5A2A', accent: '#124A7E', glow: 'rgba(160,120,40,.5)', ballMain: '#F7F7F5', ballBonus: '#F2B705' },
  euroMillions:       { primary: '#123C8E', secondary: '#3A2A8E', accent: '#6C1E8E', glow: 'rgba(80,40,140,.5)',  ballMain: '#17499E', ballBonus: '#F1C40F' },
  superEnalotto:      { primary: '#0E7A3C', secondary: '#6A6020', accent: '#B5162B', glow: 'rgba(60,110,50,.5)',  ballMain: '#098B4A', ballBonus: '#D42136' },
  lottoMax:           { primary: '#C4182F', secondary: '#8A1030', accent: '#5E0C22', glow: 'rgba(180,24,45,.5)',  ballMain: '#1B4FB8', ballBonus: '#D41F3A' },
  powerballAustralia: { primary: '#5A2AC8', secondary: '#8A2AB8', accent: '#B5169E', glow: 'rgba(140,42,160,.5)', ballMain: '#2548BA', ballBonus: '#7B239B' },
};

/** Theme for a game id (falls back to the default game's theme). */
export function themeOf(id) {
  return GAME_THEMES[id] || GAME_THEMES[DEFAULT_GAME_ID];
}
