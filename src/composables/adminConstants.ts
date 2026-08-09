export type AdminRecordKind = "characters" | "echoes";

export const FIELD_LABELS: Record<string, string> = {
  attribute: "属性",
  star_rating: "星级",
  weapon: "武器",
  birthplace: "出身地",
  version: "版本",
  skill_attribute: "技能属性",
  cost: "COST",
  is_aberration: "异相",
  set_name: "套装",
  drop_location: "掉落位置",
};

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

export const TABLE_FIELDS: Record<AdminRecordKind, string[]> = {
  characters: ["attribute", "star_rating", "weapon", "birthplace", "version"],
  echoes: ["skill_attribute", "cost", "is_aberration", "set_name", "drop_location"],
};

export const DIFF_FIELDS: Record<AdminRecordKind, string[]> = {
  characters: ["attribute", "star_rating", "weapon"],
  echoes: ["skill_attribute", "cost", "is_aberration", "set_name", "drop_location"],
};

export function tableTitle(kind: AdminRecordKind): string {
  return kind === "characters" ? "角色" : "声骸";
}

export const ADMIN_PAGE_SIZE = 30;
export const SYNC_POLL_INTERVAL = 1500;
export const SYNC_POLL_MAX = 180;
