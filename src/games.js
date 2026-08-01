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
    id: 'megaMillions', label: 'Mega Millions (5/70 + 1/24)',
    mainPool: M(1, 70, 5),
    bonusPools: [{ id: 'mega', label: 'Mega', min: 1, max: 24, drawCount: 1, colorSet: 'bonus-gold', strategy: 'separate-pool' }],
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

  // Norsk Lotto (Norsk Tipping): 7 main numbers from 1–34, then ONE additional
  // number (tilleggstall) drawn from the SAME remaining balls — one 1–34 drum,
  // exactly 34 physical balls, 8 drawn total. Verified against norsk-tipping.no.
  norwegianLotto: {
    id: 'norsk-lotto', label: 'Norsk Lotto — 7/34 + 1 tilleggstall', country: 'NO',
    mainPool: M(1, 34, 7),
    bonusPools: [{ id: 'tilleggstall', label: 'TILLEGGSTALL', min: 1, max: 34, drawCount: 1, colorSet: 'bonus-red', strategy: 'same-main-pool' }],
    drawOrder: ['main', 'tilleggstall'],
    resultLayout: { groups: [group('main', 'HOVEDTALL', 7), group('tilleggstall', 'TILLEGGSTALL', 1)] },
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

/** Size (physical ball count) of a pool's own 1..range set. */
export function poolSize(pool) { return pool.max - pool.min + 1; }

/** Total balls drawn across the whole draw (main + every bonus). */
export function totalDrawnOf(profile) {
  return drawQueueOf(profile).reduce((n, q) => n + q.count, 0);
}

/**
 * Single-source-of-truth schema validation. Returns an array of human-readable
 * problems ([] = valid). Enforces every invariant a game rule must satisfy so a
 * mis-configured lottery (wrong range, wrong counts, drawing more than exist,
 * rack/queue mismatch, bonus drawn from too small a pool, numbers out of range)
 * can never ship. `assertValidProfiles()` runs this at startup and throws.
 */
export function validateProfile(profile) {
  const e = [];
  const id = profile?.id || '(no id)';
  const main = profile?.mainPool;
  if (!main) return [`${id}: missing mainPool`];
  const okRange = (p, tag) => {
    if (!(Number.isInteger(p.min) && Number.isInteger(p.max)) || p.min < 1 || p.max < p.min) e.push(`${id}.${tag}: bad range ${p.min}..${p.max}`);
    if (!(Number.isInteger(p.drawCount) && p.drawCount >= 1)) e.push(`${id}.${tag}: bad drawCount ${p.drawCount}`);
  };
  okRange(main, 'mainPool');
  if (main.drawCount > poolSize(main)) e.push(`${id}.mainPool: drawCount ${main.drawCount} > pool size ${poolSize(main)}`);

  const pools = poolsOf(profile);
  const ids = Object.keys(pools);
  if (new Set(ids).size !== ids.length) e.push(`${id}: duplicate pool ids`);

  // Bonus pools: separate-pool must have its own valid range; same-main-pool must
  // draw within the main range and not exceed the main pool once main draws are gone.
  let sameMainBonusDraws = 0;
  for (const b of profile.bonusPools) {
    if (b.strategy !== 'separate-pool' && b.strategy !== 'same-main-pool') e.push(`${id}.${b.id}: bad strategy ${b.strategy}`);
    okRange(b, b.id);
    if (b.strategy === 'separate-pool') {
      if (b.drawCount > poolSize(b)) e.push(`${id}.${b.id}: separate-pool drawCount ${b.drawCount} > pool size ${poolSize(b)}`);
    } else if (b.strategy === 'same-main-pool') {
      if (b.min < main.min || b.max > main.max) e.push(`${id}.${b.id}: same-main-pool range ${b.min}..${b.max} outside main ${main.min}..${main.max}`);
      sameMainBonusDraws += b.drawCount;
    }
  }
  if (main.drawCount + sameMainBonusDraws > poolSize(main)) {
    e.push(`${id}: main + same-pool bonus draws ${main.drawCount + sameMainBonusDraws} exceed main pool ${poolSize(main)}`);
  }

  // Draw order + result layout must agree exactly with the pools and draw counts.
  for (const pid of profile.drawOrder) if (!pools[pid]) e.push(`${id}.drawOrder: unknown pool ${pid}`);
  const groups = profile.resultLayout?.groups || [];
  if (groups.length !== profile.drawOrder.length) e.push(`${id}: resultLayout groups (${groups.length}) ≠ drawOrder (${profile.drawOrder.length})`);
  groups.forEach((g, i) => {
    if (g.pool !== profile.drawOrder[i]) e.push(`${id}: result group ${i} pool ${g.pool} ≠ drawOrder ${profile.drawOrder[i]}`);
    const pool = pools[g.pool];
    if (pool && g.slotCount !== pool.drawCount) e.push(`${id}: ${g.pool} rack slots ${g.slotCount} ≠ drawCount ${pool.drawCount}`);
  });
  const rackSlots = groups.reduce((n, g) => n + g.slotCount, 0);
  if (rackSlots !== totalDrawnOf(profile)) e.push(`${id}: rack slots ${rackSlots} ≠ total drawn ${totalDrawnOf(profile)}`);
  return e;
}

/** Validate every shipped profile at startup; throw on the first invalid one so a
 *  broken lottery rule surfaces immediately in development, never silently. */
export function assertValidProfiles(profiles = GAME_PROFILES) {
  const all = [];
  for (const key of Object.keys(profiles)) {
    if (profiles[key].id === undefined) all.push(`${key}: missing id`);
    all.push(...validateProfile(profiles[key]));
  }
  if (all.length) throw new Error('Invalid game profile(s):\n  ' + all.join('\n  '));
}
