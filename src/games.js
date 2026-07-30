/**
 * Data-driven game profiles. The machine reads a profile and adapts EVERYTHING:
 * loaded ball count, number ranges, main + bonus draw counts, bonus pool (same
 * drum or a separate reloaded set), bonus colour, rack slots, draw sequence and
 * the result UI. Adding a new lottery = adding a profile here; nothing in the
 * physics / renderer / UI needs to change.
 *
 * Pool fields: { id, min, max, drawCount, loadedBallCount?, colorSet,
 *                strategy? ('same-main-pool' | 'separate-pool') }
 */

const M = (min, max, drawCount) => ({ id: 'main', min, max, drawCount, colorSet: 'multicolor' });
const group = (pool, label, slotCount) => ({ pool, label, slotCount });

export const GAME_PROFILES = {
  eurojackpot: {
    id: 'eurojackpot', label: 'Eurojackpot (5/50 + 2/12)',
    mainPool: M(1, 50, 5),
    bonusPools: [{ id: 'euro', label: 'Euro', min: 1, max: 12, drawCount: 2, colorSet: 'bonus-gold', strategy: 'separate-pool' }],
    drawOrder: ['main', 'euro'],
    resultLayout: { groups: [group('main', 'Основные', 5), group('euro', 'Euro', 2)] },
  },

  euromillions: {
    id: 'euromillions', label: 'EuroMillions (5/50 + 2/12)',
    mainPool: M(1, 50, 5),
    bonusPools: [{ id: 'stars', label: 'Звёзды', min: 1, max: 12, drawCount: 2, colorSet: 'bonus-gold', strategy: 'separate-pool' }],
    drawOrder: ['main', 'stars'],
    resultLayout: { groups: [group('main', 'Основные', 5), group('stars', 'Звёзды', 2)] },
  },

  powerball: {
    id: 'powerball', label: 'Powerball (5/69 + 1/26)',
    mainPool: M(1, 69, 5),
    bonusPools: [{ id: 'power', label: 'Powerball', min: 1, max: 26, drawCount: 1, colorSet: 'bonus-red', strategy: 'separate-pool' }],
    drawOrder: ['main', 'power'],
    resultLayout: { groups: [group('main', 'Основные', 5), group('power', 'Powerball', 1)] },
  },

  megaMillions: {
    id: 'megaMillions', label: 'Mega Millions (5/70 + 1/25)',
    mainPool: M(1, 70, 5),
    bonusPools: [{ id: 'mega', label: 'Mega', min: 1, max: 25, drawCount: 1, colorSet: 'bonus-gold', strategy: 'separate-pool' }],
    drawOrder: ['main', 'mega'],
    resultLayout: { groups: [group('main', 'Основные', 5), group('mega', 'Mega', 1)] },
  },

  vikinglotto: {
    id: 'vikinglotto', label: 'Vikinglotto (6/48 + 1/5)',
    mainPool: M(1, 48, 6),
    bonusPools: [{ id: 'viking', label: 'Viking', min: 1, max: 5, drawCount: 1, colorSet: 'bonus-red', strategy: 'separate-pool' }],
    drawOrder: ['main', 'viking'],
    resultLayout: { groups: [group('main', 'Основные', 6), group('viking', 'Viking', 1)] },
  },

  norwegianLotto: {
    id: 'norwegian-lotto', label: 'Norsk Lotto (7/34)',
    mainPool: M(1, 34, 7),
    bonusPools: [],
    drawOrder: ['main'],
    resultLayout: { groups: [group('main', 'Основные', 7)] },
  },

  superenalotto: {
    id: 'superenalotto', label: 'SuperEnalotto (6/90 + Jolly)',
    mainPool: M(1, 90, 6),
    bonusPools: [{ id: 'jolly', label: 'Jolly', min: 1, max: 90, drawCount: 1, colorSet: 'bonus-red', strategy: 'same-main-pool' }],
    drawOrder: ['main', 'jolly'],
    resultLayout: { groups: [group('main', 'Основные', 6), group('jolly', 'Jolly', 1)] },
  },

  italianLotto: {
    id: 'italian-lotto', label: 'Lotto Italia (5/90)',
    mainPool: M(1, 90, 5),
    bonusPools: [],
    drawOrder: ['main'],
    resultLayout: { groups: [group('main', 'Основные', 5)] },
  },
};

export const DEFAULT_PROFILE = 'eurojackpot';

/** All pools of a profile keyed by id (main + bonus). */
export function poolsOf(profile) {
  const map = { [profile.mainPool.id]: profile.mainPool };
  for (const b of profile.bonusPools) map[b.id] = b;
  return map;
}

/** The ordered draw queue: [{poolId, count}] derived from the profile. */
export function drawQueueOf(profile) {
  const pools = poolsOf(profile);
  return profile.drawOrder.map((poolId) => ({ poolId, count: pools[poolId].drawCount }));
}
