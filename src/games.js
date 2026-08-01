/**
 * Game profiles — GENERATED from the canonical registry (registry.js), which is
 * the single source of truth and mirrors the main app's 9 games. Do NOT hand-add
 * a second independent list here; add games to registry.js so the drum and the app
 * can never drift (scripts/audit-drum-games.mjs enforces they match).
 *
 * A profile drives EVERYTHING: loaded ball count, ranges, main + bonus draw counts,
 * bonus strategy (same drum or a separate reloaded set), colour, rack slots, draw
 * sequence and the result UI.
 *
 * Pool fields: { id, min, max, drawCount, colorSet,
 *                strategy? ('same-main-pool' | 'separate-pool') }
 */
import { CANONICAL_GAMES, CANONICAL_GAME_IDS, DEFAULT_GAME_ID } from './registry.js';

const M = (min, max, drawCount) => ({ id: 'main', min, max, drawCount, colorSet: 'multicolor' });
const group = (pool, label, slotCount) => ({ pool, label, slotCount });

/** Adapter: canonical registry entry → full drum profile. */
function toProfile(g) {
  const mainPool = { id: 'main', min: 1, max: g.main.max, drawCount: g.main.draw, colorSet: 'multicolor' };
  const groups = [group('main', g.main.label, g.main.draw)];
  const bonusPools = [];
  const drawOrder = ['main'];
  if (g.bonus) {
    const b = g.bonus;
    bonusPools.push({ id: b.poolId, label: b.label, min: 1, max: b.max, drawCount: b.draw, colorSet: b.colorSet, strategy: b.strategy });
    drawOrder.push(b.poolId);
    groups.push(group(b.poolId, b.label, b.draw));
  }
  return { id: g.id, label: g.label, name: g.name, country: g.country, mainPool, bonusPools, drawOrder, resultLayout: { groups } };
}

/** The 9 public game profiles, keyed by the main app's game id (registry order). */
export const GAME_PROFILES = Object.fromEntries(CANONICAL_GAMES.map((g) => [g.id, toProfile(g)]));

/** Inactive/internal profiles — kept as code but NEVER shown in the public selector
 *  (not part of the main app's current game set). */
export const INACTIVE_PROFILES = {
  italianLotto: {
    id: 'italian-lotto', label: 'Lotto Italia (5/90)', name: 'Lotto Italia',
    mainPool: M(1, 90, 5), bonusPools: [], drawOrder: ['main'],
    resultLayout: { groups: [group('main', 'Основные', 5)] },
  },
};

export const DEFAULT_PROFILE = DEFAULT_GAME_ID;

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

/** The drum's public game set must equal the canonical registry EXACTLY — same
 *  count, same ids, no duplicates, no missing, no extras. Throws otherwise, so the
 *  drum can never silently drift from the main app's game list. */
export function assertRegistryConsistency(profiles = GAME_PROFILES, canonicalIds = CANONICAL_GAME_IDS) {
  const drumIds = Object.keys(profiles);
  const errs = [];
  if (new Set(drumIds).size !== drumIds.length) errs.push('duplicate drum profile ids');
  const setC = new Set(canonicalIds), setD = new Set(drumIds);
  for (const id of canonicalIds) if (!setD.has(id)) errs.push(`missing drum profile for canonical game "${id}"`);
  for (const id of drumIds) if (!setC.has(id)) errs.push(`extra drum profile "${id}" not in canonical registry`);
  if (drumIds.length !== canonicalIds.length) errs.push(`drum profile count ${drumIds.length} ≠ canonical ${canonicalIds.length}`);
  if (errs.length) throw new Error('Drum ↔ canonical registry mismatch:\n  ' + errs.join('\n  '));
}
