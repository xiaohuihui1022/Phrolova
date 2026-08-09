import { buildDivideMemberGroups, buildDivideSetToAttrs } from './divide-data';

// ── 颜色分组（用于套装图片颜色匹配，由于没有 PIL，我们用预定义映射） ─────────
const _COLOR_GROUPS: Record<string, string> = {
  green: 'green', teal: 'green',
  blue: 'blue', cyan: 'blue',
  purple: 'purple',
  red: 'warm', orange: 'warm', magenta: 'warm', pink: 'warm',
  yellow: 'yellow',
  gray: 'neutral', white: 'neutral', black: 'neutral',
};

const _STATUS_BG_GROUP: Record<string, string> = {
  match: 'green',
  near: 'warm',
  different: 'neutral',
};

// 预定义套装名 -> 颜色家族映射（基于常见印象，可后续微调）
const _SET_COLOR_FAMILY: Record<string, string> = {
  // 衍射
  '逆光跃彩之约': 'purple', '流金溯真之式': 'yellow', '浮星祛暗': 'blue', '此间永驻之光': 'warm',
  // 热熔
  '冥途夜行之灯': 'warm', '斑驳粉饰之沫': 'warm', '长路启航之星': 'warm',
  '熔山裂谷': 'warm', '奔狼燎原之焰': 'red', '焚羽猎魔之影': 'warm',
  // 冷凝
  '剪心辑梦之影': 'blue', '雪落无声之愿': 'neutral', '凝夜白霜': 'blue', '凌冽决断之心': 'blue',
  // 导电
  '彻空冥雷': 'yellow',
  // 湮灭
  '沉日劫明': 'purple', '幽夜隐匿之帷': 'purple', '失序彼岸之梦': 'neutral', '命理崩毁之弦': 'purple',
  // 气动
  '清邪荡煞之心': 'green', '听唤语义之愿': 'green', '星构寻辉之环': 'green',
  '啸谷长风': 'green', '隐世回光': 'green', '流云逝尽之空': 'green', '愿戴荣光之旅': 'green',
  // 全属性
  '羽落空尘之歌': 'neutral', '轻云出月': 'neutral', '无惧浪涛之勇': 'neutral',
  // 其他常见
  '不绝余音': 'purple', '高天共奏之曲': 'yellow',
  '荣斗铸锋之冠': 'warm', '息界同调之律': 'neutral',
  '碎梦亡鬼之魇': 'purple', '战歌重奏-烬夜天启之章': 'warm',
};

function setColorFamily(name: string): string {
  return _SET_COLOR_FAMILY[name] ?? 'neutral';
}

function setHasImage(_name: string): boolean {
  // Cloudflare Pages 环境下我们简化：如果在映射中存在则认为有图
  return true;
}

export function needWhiten(name: string, status: string): boolean {
  if (!setHasImage(name)) return false;
  const imageGroup = _COLOR_GROUPS[setColorFamily(name)] ?? 'neutral';
  return imageGroup === (_STATUS_BG_GROUP[status] ?? 'neutral');
}

// ── 工具函数 ─────────────────────────────────────────────────────────
function splitField(value: unknown): string[] {
  if (!value) return [];
  return String(value).replace(/，/g, ',').split(',').map(s => s.trim()).filter(Boolean);
}

// ── 版本号近邻判断 ──────────────────────────────────────────────────
const _VERSION_ORDER = [
  '1.0', '1.1', '1.2', '1.3', '1.4',
  '2.0', '2.1', '2.2', '2.3', '2.4', '2.5', '2.6', '2.7', '2.8',
  '3.0', '3.1', '3.2', '3.3', '3.4', '3.5',
];
const _VERSION_INDEX: Record<string, number> = Object.fromEntries(
  _VERSION_ORDER.map((v, i) => [v, i])
);

function normalizeVersion(v: unknown): string {
  try {
    const str = String(v).trim();
    const num = parseFloat(str);
    if (!isFinite(num)) return str;
    // 保留 1 位小数，确保 "1.0" 不会变成 "1" 导致在 _VERSION_INDEX 中查不到
    return Number(num).toFixed(1);
  } catch {
    return String(v).trim();
  }
}

function isNearVersion(a: unknown, b: unknown): boolean {
  const ia = _VERSION_INDEX[normalizeVersion(a)];
  const ib = _VERSION_INDEX[normalizeVersion(b)];
  if (ia === undefined || ib === undefined) return false;
  return Math.abs(ia - ib) <= 2;
}

// ── cell 状态判断 ───────────────────────────────────────────────────
type TokenStatus = 'match' | 'near' | 'different';
type CellStatus = 'match' | 'partial' | 'different';

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

// ── 多字段对比 ─────────────────────────────────────────────────────
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
  // 按 divide-data.ts 属性分组判断 near（而非颜色分组）
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

// ── 单字段对比 ──────────────────────────────────────────────────────
export type FieldStatus = 'match' | 'near' | 'different';

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

// ── 角色（Resonator）对比 ──────────────────────────────────────────
export type CharacterCompareResult = {
  attribute: FieldStatus;
  star_rating: FieldStatus;
  weapon: FieldStatus;
  birthplace: FieldStatus;
  version: FieldStatus;
};

export function buildCompareCharacter(target: Record<string, unknown>, guess: Record<string, unknown>): CharacterCompareResult {
  return {
    attribute: compareField(target.attribute, guess.attribute, 'attribute'),
    star_rating: compareField(target.starRating ?? target.star_rating, guess.starRating ?? guess.star_rating, 'star_rating'),
    weapon: compareField(target.weapon, guess.weapon, 'weapon'),
    birthplace: compareField(target.birthplace, guess.birthplace, 'birthplace'),
    version: compareField(target.version, guess.version, 'version'),
  };
}

// ── 声骸（Skeleton）对比 ────────────────────────────────────────────
export type ListFieldCompare = {
  cell: CellStatus;
  items: Array<Record<string, unknown>>;
};

export type SkeletonCompareResult = {
  skill_attribute: ListFieldCompare;
  cost: FieldStatus;
  is_aberration: FieldStatus;
  set_name: ListFieldCompare;
  drop_location: ListFieldCompare;
};

export function buildCompareSkeleton(
  target: Record<string, unknown>,
  guess: Record<string, unknown>,
): SkeletonCompareResult {
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
      items: skillAttrItems as unknown as Array<Record<string, unknown>>,
    },
    cost: compareField(target.cost, guess.cost, 'cost'),
    is_aberration: compareField(
      target.isAberration ?? target.is_aberration,
      guess.isAberration ?? guess.is_aberration,
      'is_aberration',
    ),
    set_name: {
      cell: cellStatus(targetSets, guessSets, setItems.map(i => i.status)),
      items: setItems as unknown as Array<Record<string, unknown>>,
    },
    drop_location: {
      cell: cellStatus(targetLocs, guessLocs, locItems.map(i => i.status)),
      items: locItems as unknown as Array<Record<string, unknown>>,
    },
  };
}

export type CompareResult = CharacterCompareResult | SkeletonCompareResult;
export type QuizType = 'resonator' | 'skeleton';

export function buildCompareByType(
  target: Record<string, unknown>,
  guess: Record<string, unknown>,
  quizType: QuizType,
): CompareResult {
  return quizType === 'skeleton'
    ? buildCompareSkeleton(target, guess)
    : buildCompareCharacter(target, guess);
}

// ── 判断是否全对 ────────────────────────────────────────────────────
type ListFieldMatch = { cell: string; items: Array<Record<string, unknown>> };

function listFieldMatch(value: unknown): boolean {
  const v = value as ListFieldMatch | undefined;
  if (!v || typeof v !== 'object' || !('items' in v)) return false;
  return Boolean(v.items?.length) && v.cell === 'match';
}

export function allMatch(compareResult: Record<string, unknown>): boolean {
  for (const value of Object.values(compareResult)) {
    if (value && typeof value === 'object' && 'items' in (value as Record<string, unknown>)) {
      if (!listFieldMatch(value)) return false;
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

// ── 规范化行（用于 DB 行序列化到 target_json） ─────────────────────
export function normalizeRow(row: Record<string, unknown>, quizType: QuizType): Record<string, unknown> {
  if (quizType === 'skeleton') {
    return {
      id: row.id,
      name: row.name,
      skillAttribute: row.skillAttribute ?? row.skill_attribute,
      cost: row.cost,
      isAberration: row.isAberration ?? row.is_aberration,
      setName: row.setName ?? row.set_name,
      dropLocation: row.dropLocation ?? row.drop_location,
    };
  }
  return {
    id: row.id,
    name: row.name,
    attribute: row.attribute,
    starRating: row.starRating ?? row.star_rating,
    weapon: row.weapon,
    birthplace: row.birthplace,
    version: row.version,
  };
}

// ── DB 行转换为前端约定的 snake_case（ResonatorRow / SkeletonRow 类型）──
// Drizzle schema 使用 camelCase 属性映射 DB 列名，但前端类型定义使用 snake_case
export function toFrontendRow(row: Record<string, unknown>, quizType: QuizType): Record<string, unknown> {
  if (quizType === 'skeleton') {
    return {
      id: Number(row.id ?? 0),
      name: String(row.name ?? ''),
      skill_attribute: String(row.skillAttribute ?? row.skill_attribute ?? ''),
      cost: Number(row.cost ?? 0),
      is_aberration: String(row.isAberration ?? row.is_aberration ?? ''),
      set_name: String(row.setName ?? row.set_name ?? ''),
      drop_location: String(row.dropLocation ?? row.drop_location ?? ''),
    };
  }
  return {
    id: Number(row.id ?? 0),
    name: String(row.name ?? ''),
    attribute: String(row.attribute ?? ''),
    star_rating: Number(row.starRating ?? row.star_rating ?? 0),
    weapon: String(row.weapon ?? ''),
    birthplace: String(row.birthplace ?? ''),
    version: Number(row.version ?? 0),
  };
}
