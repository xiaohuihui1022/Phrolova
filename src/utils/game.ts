import type {
  CellStatus,
  CompareAttrItem,
  CompareStatus,
  CompareLocationItem,
  CompareSetItem,
  GuessHistoryRow,
  QuizType,
  ResonatorCompare,
  ResonatorRow,
  SkeletonCompare,
  SkeletonRow,
} from "@/types/game";

const resonatorColumns = [
  { key: "name", label: "column.name" },
  { key: "attribute", label: "column.attribute" },
  { key: "star_rating", label: "column.starRating" },
  { key: "weapon", label: "column.weapon" },
  { key: "birthplace", label: "column.birthplace" },
  { key: "version", label: "column.version" },
] as const;

const skeletonColumns = [
  { key: "name", label: "column.skeletonName" },
  { key: "skill_attribute", label: "column.skillAttribute" },
  { key: "cost", label: "column.cost" },
  { key: "is_aberration", label: "column.isAberration" },
  { key: "set_name", label: "column.setName" },
  { key: "drop_location", label: "column.dropLocation" },
] as const;

export function getColumns(quizType: QuizType) {
  return quizType === "skeleton" ? skeletonColumns : resonatorColumns;
}

export function getStatusClass(status: CompareStatus | CellStatus) {
  if (status === "match") return "feedback-cell feedback-cell-match";
  if (status === "near") return "feedback-cell feedback-cell-near";
  if (status === "partial") return "feedback-cell feedback-cell-partial";
  return "feedback-cell feedback-cell-different";
}

export function formatGuessValue(
  row: ResonatorRow | SkeletonRow | Record<string, unknown>,
  key: string,
  options?: { targetVersion?: number | null; targetCost?: number | null },
) {
  const value = getRowValue(row, key);
  if (value === undefined || value === null) return "—";
  if (key === "star_rating") {
    return "★".repeat(Number(value));
  }
  if (key === "version") {
    const numeric = Number(value).toFixed(1);
    if (options?.targetVersion === null || options?.targetVersion === undefined) {
      return numeric;
    }
    if (Number(value) < options.targetVersion) return `${numeric} ↑`;
    if (Number(value) > options.targetVersion) return `${numeric} ↓`;
    return numeric;
  }
  if (key === "cost") {
    if (options?.targetCost === null || options?.targetCost === undefined) {
      return String(value);
    }
    if (Number(value) < options.targetCost) return `${value} ↑`;
    if (Number(value) > options.targetCost) return `${value} ↓`;
  }
  return String(value);
}

/** 获取行字段值，兼容 snake_case 和 camelCase（Drizzle schema 返回 camelCase）*/
export function getRowValue(
  row: ResonatorRow | SkeletonRow | Record<string, unknown>,
  key: string,
): unknown {
  const obj = row as Record<string, unknown>;
  let value = obj[key];
  if (value === undefined || value === null) {
    if (key === "star_rating") value = obj["starRating"];
    else if (key === "skill_attribute") value = obj["skillAttribute"];
    else if (key === "is_aberration") value = obj["isAberration"];
    else if (key === "set_name") value = obj["setName"];
    else if (key === "drop_location") value = obj["dropLocation"];
  }
  return value;
}

export function renderGroupItem(item: CompareAttrItem | CompareSetItem | CompareLocationItem | Record<string, unknown>) {
  if ("attr" in item) return item.attr;
  if ("set" in item) return item.set;
  return String(item.loc ?? "");
}

const WEAPON_ICON_MAP: Record<string, string> = {
  佩枪: "/media/weapons/佩枪.png",
  配枪: "/media/weapons/佩枪.png",
  迅刀: "/media/weapons/迅刀.png",
  长刃: "/media/weapons/长刃.png",
  臂铠: "/media/weapons/臂铠.png",
  音感仪: "/media/weapons/音感仪.png",
};

export function getWeaponIcon(weapon: string): string | null {
  return WEAPON_ICON_MAP[weapon] || null;
}

export function getCharacterAvatar(name: string): string {
  const base = name.split("-")[0];
  return `/media/characters/角色 ${base} 头像.png`;
}

export function getSkeletonAvatar(name: string): string {
  return `/media/echo/声骸 ${name} 头像.png`;
}

export function toHistoryRow(
  guess: ResonatorRow | SkeletonRow,
  compare: ResonatorCompare | SkeletonCompare,
): GuessHistoryRow {
  return {
    revealed: true,
    guess,
    compare,
  };
}
