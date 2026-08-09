export type BadgeCategory =
  | "attribute"
  | "birthplace"
  | "location"
  | "weapon"
  | "set"
  | "plain";

export interface BadgeMeta {
  accent: string;
  mark: string;
  iconUrl?: string;
}

const attributeMeta: Record<string, BadgeMeta> = {
  湮灭: { accent: "#d584c3", mark: "湮", iconUrl: "/media/attributes/havoc.png" },
  导电: { accent: "#c29b4f", mark: "电", iconUrl: "/media/attributes/electro.png" },
  冷凝: { accent: "#76bcd8", mark: "凝", iconUrl: "/media/attributes/glacio.png" },
  热熔: { accent: "#cc7558", mark: "焰", iconUrl: "/media/attributes/fusion.png" },
  衍射: { accent: "#d7c989", mark: "衍", iconUrl: "/media/attributes/spectro.png" },
  气动: { accent: "#65b89a", mark: "风", iconUrl: "/media/attributes/air.png" },
};

const birthplaceMeta: Record<string, BadgeMeta> = {
  瑝珑: { accent: "#c7a25b", mark: "珑" },
  新联邦: { accent: "#7da1c5", mark: "新" },
  黑海岸: { accent: "#8ea3b9", mark: "岸" },
  黎那汐塔: { accent: "#d7bd86", mark: "塔" },
  苇原: { accent: "#92b07d", mark: "苇" },
  拉海洛: { accent: "#b18a68", mark: "洛" },
  未知: { accent: "#8f8f96", mark: "?" },
};

const locationMeta: Record<string, BadgeMeta> = {
  ...birthplaceMeta,
  今州: { accent: "#789db9", mark: "今" },
  拉古那: { accent: "#9ab7c7", mark: "海" },
  七丘: { accent: "#ab9d7e", mark: "丘" },
  隐海试炼场: { accent: "#8c84ad", mark: "试" },
  罗伊冰原: { accent: "#8ec4d2", mark: "冰" },
  梦州: { accent: "#a38cb8", mark: "梦" },
  穂波: { accent: "#8fb1b4", mark: "穂" },
};

const weaponMeta: Record<string, BadgeMeta> = {
  迅刀: { accent: "#9ca7b3", mark: "刀" },
  长刃: { accent: "#ae9580", mark: "刃" },
  佩枪: { accent: "#9c8ac4", mark: "枪" },
  配枪: { accent: "#9c8ac4", mark: "枪" },
  音感仪: { accent: "#a886b8", mark: "音" },
  臂铠: { accent: "#7f9b9e", mark: "铠" },
};

const setMeta: Record<string, BadgeMeta> = {
  轻云出月: { accent: "#7f98bf", mark: "云" },
  凝夜白霜: { accent: "#89bacd", mark: "霜" },
  沉日劫明: { accent: "#c97d61", mark: "劫" },
  隐世回光: { accent: "#d5c38b", mark: "光" },
  彻空冥雷: { accent: "#c6a15d", mark: "雷" },
  熔山裂谷: { accent: "#b96c55", mark: "熔" },
  啸谷长风: { accent: "#67b59b", mark: "风" },
  浮星祛暗: { accent: "#d4cf97", mark: "星" },
};

function fallbackMeta(label: string): BadgeMeta {
  return {
    accent: "#8f8d84",
    mark: label.trim().slice(0, 1) || "·",
  };
}

export function getBadgeMeta(label: string, category: BadgeCategory = "plain"): BadgeMeta {
  const normalized = label.trim();
  if (!normalized) {
    return fallbackMeta(label);
  }

  if (category === "attribute") {
    return attributeMeta[normalized] ?? fallbackMeta(normalized);
  }
  if (category === "birthplace") {
    return birthplaceMeta[normalized] ?? fallbackMeta(normalized);
  }
  if (category === "location") {
    return locationMeta[normalized] ?? birthplaceMeta[normalized] ?? fallbackMeta(normalized);
  }
  if (category === "weapon") {
    return weaponMeta[normalized] ?? fallbackMeta(normalized);
  }
  if (category === "set") {
    return setMeta[normalized] ?? fallbackMeta(normalized);
  }
  return fallbackMeta(normalized);
}

export function resolveBadgeCategory(key: string, value: string): BadgeCategory {
  if (key === "attribute" || attributeMeta[value]) {
    return "attribute";
  }
  if (key === "birthplace") {
    return "birthplace";
  }
  if (key === "weapon") {
    return "weapon";
  }
  if (key === "drop_location") {
    return "location";
  }
  if (key === "set_name") {
    return "set";
  }
  return "plain";
}
