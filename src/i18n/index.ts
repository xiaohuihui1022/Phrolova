import { computed, ref, watch } from "vue";
import { createI18n } from "vue-i18n";

import zhCN from "./locales/zh-CN";
import zhTW from "./locales/zh-TW";
import en from "./locales/en";

export type AppLocale = "zh-CN" | "zh-TW" | "en";

export const LOCALE_KEY = "phrolova_locale";

export const availableLocales: { value: AppLocale; label: string }[] = [
  { value: "zh-CN", label: "简体中文" },
  { value: "zh-TW", label: "繁體中文" },
  { value: "en", label: "English" },
];

/** 浏览器语言 → 应用 locale 映射 */
function detectLocale(): AppLocale {
  // 1. localStorage 已保存的偏好
  try {
    const saved = localStorage.getItem(LOCALE_KEY);
    if (saved === "zh-CN" || saved === "zh-TW" || saved === "en") return saved;
  } catch { /* ignore */ }

  // 2. navigator.language 匹配
  if (typeof navigator !== "undefined") {
    const lang = navigator.language || (navigator as any).userLanguage || "";
    const lower = lang.toLowerCase();
    if (lower.startsWith("zh-tw") || lower.startsWith("zh-hk") || lower.startsWith("zh-mo") || lower.startsWith("zh-hant")) {
      return "zh-TW";
    }
    if (lower.startsWith("en")) {
      return "en";
    }
    // 其他 zh-* (zh-CN, zh-SG, zh-Hans) 或无法识别 → 默认简体
  }

  // 3. 默认
  return "zh-CN";
}

const detected = detectLocale();

export const i18n = createI18n({
  legacy: false,
  locale: detected,
  fallbackLocale: "zh-CN",
  messages: {
    "zh-CN": zhCN,
    "zh-TW": zhTW,
    en,
  },
  missingWarn: false,
  fallbackWarn: false,
});

// 同步 <html lang> 和 document.title
function updateHtmlLang(locale: AppLocale) {
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale;
  }
}

// 页面标题映射
const TITLE_MAP: Record<AppLocale, string> = {
  "zh-CN": "Phrolova / 鸣潮猜谜游戏",
  "zh-TW": "Phrolova / 鳴潮猜謎遊戲",
  en: "Phrolova / Wuthering Waves Guessing Game",
};

function updateTitle(locale: AppLocale) {
  if (typeof document !== "undefined") {
    document.title = TITLE_MAP[locale];
  }
}

// 初始化时同步一次
updateHtmlLang(detected);
updateTitle(detected);

// 监听 locale 变化，同步 localStorage + html lang + title
watch(
  () => i18n.global.locale.value,
  (val: string) => {
    const locale = val as AppLocale;
    try {
      localStorage.setItem(LOCALE_KEY, locale);
    } catch { /* ignore */ }
    updateHtmlLang(locale);
    updateTitle(locale);
  },
);

/** 组合式 API：在组件中使用 */
export function useLocale() {
  const locale = computed({
    get: () => i18n.global.locale.value as AppLocale,
    set: (val: AppLocale) => { i18n.global.locale.value = val; },
  });

  function setLocale(val: AppLocale) {
    i18n.global.locale.value = val;
  }

  return { locale, setLocale, availableLocales };
}
