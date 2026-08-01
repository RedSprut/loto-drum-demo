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
