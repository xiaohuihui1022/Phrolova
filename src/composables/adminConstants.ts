import { i18n } from "@/i18n";

export type AdminRecordKind = "characters" | "echoes";

const FIELD_LABEL_KEYS: Record<string, string> = {
  attribute: "admin.fieldAttribute",
  star_rating: "admin.fieldStarRating",
  weapon: "admin.fieldWeapon",
  birthplace: "admin.fieldBirthplace",
  version: "admin.fieldVersion",
  skill_attribute: "admin.fieldSkillAttribute",
  cost: "admin.fieldCost",
  is_aberration: "admin.fieldIsAberration",
  set_name: "admin.fieldSetName",
  drop_location: "admin.fieldDropLocation",
};

export function fieldLabel(field: string): string {
  const key = FIELD_LABEL_KEYS[field];
  return key ? i18n.global.t(key) : field;
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
  return i18n.global.t(kind === "characters" ? "admin.characters" : "admin.echoes");
}

export const ADMIN_PAGE_SIZE = 30;
export const SYNC_POLL_INTERVAL = 1500;
export const SYNC_POLL_MAX = 180;
