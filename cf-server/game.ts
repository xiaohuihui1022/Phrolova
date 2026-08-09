// 游戏逻辑工具：抽题、查找、对比、记分
// 直接使用 D1Database API（不依赖 drizzle-orm，因为 Worker 环境中 Drizzle 需要特殊配置）

import type { QuizType, Difficulty } from './protocol';
import { buildDivideSetToAttrs, buildDivideMemberGroups } from '../src/lib/divide-data';

const _VERSION_ORDER = [
  '1.0', '1.1', '1.2', '1.3', '1.4',
  '2.0', '2.1', '2.2', '2.3', '2.4', '2.5', '2.6', '2.7', '2.8',
  '3.0', '3.1', '3.2', '3.3', '3.4', '3.5',
];

// ── 辅助函数 ──
function splitField(value: unknown): string[] {
  if (!value) return [];
  return String(value).replace(/，/g, ',').split(',').map(s => s.trim()).filter(Boolean);
}

function normalizeVersion(v: unknown): string {
  try {
    const str = String(v).trim();
    const num = parseFloat(str);
    if (!isFinite(num)) return str;
    // 保留 1 位小数，确保 "1.0" 不会变成 "1" 导致在 _VERSION_ORDER 中 indexOf 返回 -1
    return Number(num).toFixed(1);
  } catch {
    return String(v).trim();
  }
}

function isNearVersion(a: unknown, b: unknown): boolean {
  const ia = _VERSION_ORDER.indexOf(normalizeVersion(a));
  const ib = _VERSION_ORDER.indexOf(normalizeVersion(b));
  if (ia === -1 || ib === -1) return false;
  return Math.abs(ia - ib) <= 2;
}

// ── 抽题 ──
export async function drawTarget(
  db: D1Database,
  quizType: QuizType,
  difficulty: Difficulty,
): Promise<Record<string, unknown>> {
  if (quizType === 'skeleton') {
    if (difficulty === 'easy') {
      const result = await db.prepare(
        'SELECT * FROM sound_skeletons WHERE cost = 4 ORDER BY RANDOM() LIMIT 1'
      ).all();
      return result.results[0] ?? {};
    }
    const result = await db.prepare(
      'SELECT * FROM sound_skeletons ORDER BY RANDOM() LIMIT 1'
    ).all();
    return result.results[0] ?? {};
  }
  const result = await db.prepare(
    'SELECT * FROM characters ORDER BY RANDOM() LIMIT 1'
  ).all();
  return result.results[0] ?? {};
}

// ── 查找猜测 ──
export async function lookupGuess(
  db: D1Database,
  quizType: QuizType,
  name: string,
): Promise<Record<string, unknown> | null> {
  const table = quizType === 'skeleton' ? 'sound_skeletons' : 'characters';
  const result = await db.prepare(
    `SELECT * FROM ${table} WHERE name = ?1 LIMIT 1`
  ).bind(name).all();
  return result.results[0] ?? null;
}

// ── 对比逻辑 ──
type TokenStatus = 'match' | 'near' | 'different';
type CellStatus = 'match' | 'partial' | 'different';
type FieldStatus = 'match' | 'near' | 'different';

function cellStatus(
  targetList: string[],
  guessList: string[],
  tokenStatuses?: TokenStatus[],
): CellStatus {
  if (!guessList.length) return 'different';
  const targetSet = new Set(targetList);
  const guessSet = new Set(guessList);
  if (targetSet.size === guessSet.size && [...targetSet].every(x => guessSet.has(x))) {
    return 'match';
  }
  if (!tokenStatuses) {
    return [...guessSet].some(x => targetSet.has(x)) ? 'partial' : 'different';
  }
  const greenCount = tokenStatuses.filter(s => s === 'match').length;
  const countDiff = Math.abs(targetSet.size - guessSet.size);
  if (greenCount === 0) return 'different';
  if (countDiff >= 2) return 'different';
  return 'partial';
}

function compareField(target: unknown, guess: unknown, fieldName: string): FieldStatus {
  if (target === guess) return 'match';
  if (fieldName === 'starRating' || fieldName === 'star_rating') return 'near';
  if (fieldName === 'version') return isNearVersion(target, guess) ? 'near' : 'different';
  if (fieldName === 'cost') {
    const diff = Math.abs(Number(target) - Number(guess));
    return diff <= 1 ? 'near' : 'different';
  }
  return 'different';
}

function compareSkillAttributes(
  targetAttrs: string[],
  guessAttrs: string[],
  targetSets?: string[],
): Array<{ attr: string; status: TokenStatus }> {
  const setToAttrs = buildDivideSetToAttrs();
  const inferred = new Set<string>();
  if (targetSets) {
    for (const setName of targetSets) {
      for (const a of setToAttrs[setName] ?? []) inferred.add(a);
    }
  }
  const result: Array<{ attr: string; status: TokenStatus }> = [];
  for (const attr of guessAttrs) {
    let status: TokenStatus = 'different';
    if (targetAttrs.includes(attr)) status = 'match';
    else if (inferred.has(attr)) status = 'near';
    result.push({ attr, status });
  }
  return result;
}

function compareSets(
  targetSets: string[],
  guessSets: string[],
): Array<{ set: string; status: TokenStatus; has_image: boolean; whiten: boolean }> {
  const memberGroups = buildDivideMemberGroups();
  const targetGroups = new Set<string>();
  for (const s of targetSets) {
    for (const g of memberGroups[s] ?? []) targetGroups.add(g);
  }

  const result: Array<{ set: string; status: TokenStatus; has_image: boolean; whiten: boolean }> = [];
  for (const setName of guessSets) {
    let status: TokenStatus = 'different';
    if (targetSets.includes(setName)) status = 'match';
    else if ([...(memberGroups[setName] ?? [])].some(g => targetGroups.has(g))) status = 'near';
    result.push({
      set: setName,
      status,
      has_image: true,
      whiten: false,
    });
  }
  return result;
}

function compareDropLocations(
  targetLocs: string[],
  guessLocs: string[],
): Array<{ loc: string; status: TokenStatus }> {
  const memberGroups = buildDivideMemberGroups();
  const targetGroups = new Set<string>();
  for (const loc of targetLocs) {
    for (const g of memberGroups[loc] ?? []) targetGroups.add(g);
  }
  const result: Array<{ loc: string; status: TokenStatus }> = [];
  for (const loc of guessLocs) {
    let status: TokenStatus = 'different';
    if (targetLocs.includes(loc)) status = 'match';
    else if ([...(memberGroups[loc] ?? [])].some(g => targetGroups.has(g))) status = 'near';
    result.push({ loc, status });
  }
  return result;
}

// ── 构建对比 ──
export function buildCompare(
  target: Record<string, unknown>,
  guess: Record<string, unknown>,
  quizType: QuizType,
): Record<string, unknown> {
  if (quizType === 'skeleton') {
    return buildSkeletonCompare(target, guess);
  }
  return buildResonatorCompare(target, guess);
}

function buildResonatorCompare(
  target: Record<string, unknown>,
  guess: Record<string, unknown>,
): Record<string, unknown> {
  return {
    attribute: compareField(target.attribute, guess.attribute, 'attribute'),
    star_rating: compareField(
      target.starRating ?? target.star_rating,
      guess.starRating ?? guess.star_rating,
      'star_rating'
    ),
    weapon: compareField(target.weapon, guess.weapon, 'weapon'),
    birthplace: compareField(target.birthplace, guess.birthplace, 'birthplace'),
    version: compareField(target.version, guess.version, 'version'),
  };
}

function buildSkeletonCompare(
  target: Record<string, unknown>,
  guess: Record<string, unknown>,
): Record<string, unknown> {
  const targetAttrs = splitField(target.skillAttribute ?? target.skill_attribute);
  const guessAttrs = splitField(guess.skillAttribute ?? guess.skill_attribute);
  const targetSets = splitField(target.setName ?? target.set_name);
  const guessSets = splitField(guess.setName ?? guess.set_name);
  const targetLocs = splitField(target.dropLocation ?? target.drop_location);
  const guessLocs = splitField(guess.dropLocation ?? guess.drop_location);

  const skillAttrItems = compareSkillAttributes(targetAttrs, guessAttrs, targetSets);
  const setItems = compareSets(targetSets, guessSets);
  const locItems = compareDropLocations(targetLocs, guessLocs);

  return {
    skill_attribute: {
      cell: cellStatus(targetAttrs, guessAttrs, skillAttrItems.map(i => i.status)),
      items: skillAttrItems,
    },
    cost: compareField(target.cost, guess.cost, 'cost'),
    is_aberration: compareField(
      target.isAberration ?? target.is_aberration,
      guess.isAberration ?? guess.is_aberration,
      'is_aberration'
    ),
    set_name: {
      cell: cellStatus(targetSets, guessSets, setItems.map(i => i.status)),
      items: setItems,
    },
    drop_location: {
      cell: cellStatus(targetLocs, guessLocs, locItems.map(i => i.status)),
      items: locItems,
    },
  };
}

// ── 判断是否全对 ──
export function allMatch(compareResult: Record<string, unknown>): boolean {
  for (const value of Object.values(compareResult)) {
    if (value && typeof value === 'object' && 'items' in (value as Record<string, unknown>)) {
      const v = value as { cell: string; items: Array<{ status: string }> };
      if (!v.items?.length) return false;
      if (v.cell !== 'match') return false;
      for (const item of v.items) {
        if (item.status !== 'match') return false;
      }
    } else if (Array.isArray(value)) {
      if (!value.length) return false;
      for (const item of value) {
        if ((item as Record<string, unknown>)?.status !== 'match') return false;
      }
    } else if (value !== 'match') {
      return false;
    }
  }
  return true;
}

// ── 记分（多人） ──
export async function applyMultiScore(
  db: D1Database,
  winnerId: string,
  loserId: string,
  delta: number,
): Promise<void> {
  // 胜者加分
  await db.prepare(
    `UPDATE players SET score = MAX(0, score + ?1), wins = wins + 1, matches = matches + 1 WHERE player_id = ?2`
  ).bind(delta, winnerId).run();

  // 败者扣分并加比赛次数
  await db.prepare(
    `UPDATE players SET score = MAX(0, score - ?1), matches = matches + 1 WHERE player_id = ?2`
  ).bind(delta, loserId).run();
}

// ── 记录比赛（简化版） ──
export async function recordMatch(
  db: D1Database,
  winnerId: string,
  loserId: string,
): Promise<void> {
  await applyMultiScore(db, winnerId, loserId, 0);
}