import { ref, watch, type Ref } from "vue";

/**
 * Reactive localStorage wrapper. Reads on init, writes on change.
 * Each instance is a standalone ref — reads from storage at creation time.
 */
export function useLocalStorage<T = string>(key: string, fallback: T): Ref<T> {
  const stored = readStorage<T>(key, fallback);
  const value = ref<T>(stored) as Ref<T>;

  watch(value, (next) => {
    writeStorage(key, next);
  }, { deep: true });

  return value;
}

/** Non-reactive one-shot read. */
export function readLocalStorage<T = string>(key: string, fallback: T): T {
  return readStorage(key, fallback);
}

export function writeLocalStorage<T = string>(key: string, value: T): void {
  writeStorage(key, value);
}

export function removeLocalStorage(key: string): void {
  try { localStorage.removeItem(key); } catch { /* noop */ }
}

/* ── Cookie helpers（登录态持久化，替代 localStorage） ── */
/* 用户未同意 Cookie（declined）时，登录态写入 sessionStorage：刷新页面保持，关闭标签页丢失；
   已同意（accepted）或尚未选择（null，默认允许）时，写入真实 document.cookie（30 天）。 */

/** Auth cookie 默认有效期（30 天），与原 localStorage 持久化语义对齐；实际登录态由后端 token 校验/轮换控制 */
export const AUTH_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

const COOKIE_CONSENT_KEY = 'phrolova_cookie_consent';
/** 受 Cookie 同意策略管控的键（登录态相关） */
const AUTH_COOKIE_KEYS = [
  'phrolova_player_id',
  'phrolova_player_token',
  'phrolova_logged_in',
  'phrolova_auth_hint',
  'phrolova_admin_hint',
  'admin_token',
];
/** declined 模式下 sessionStorage 中的 key 前缀 */
const FALLBACK_PREFIX = '__cookie_fallback__:';

type CookieConsent = 'accepted' | 'declined';
let _cookieConsent: CookieConsent | null = null;
let _consentLoaded = false;

function loadConsent(): void {
  if (_consentLoaded) return;
  try {
    const v = localStorage.getItem(COOKIE_CONSENT_KEY);
    _cookieConsent = v === 'accepted' || v === 'declined' ? v : null;
  } catch { _cookieConsent = null; }
  _consentLoaded = true;
}

/** 读取当前 Cookie 同意状态（null = 尚未选择） */
export function getCookieConsent(): CookieConsent | null {
  loadConsent();
  return _cookieConsent;
}

/** 是否允许写入真实 Cookie（declined 才禁止；null 视为允许，避免首次访问阻断登录） */
export function hasCookieConsent(): boolean {
  loadConsent();
  return _cookieConsent !== 'declined';
}

/* ── declined 模式下的 sessionStorage 镜像（刷新保持，关闭标签页丢失） ── */

function fallbackRead(key: string): string | null {
  try { return sessionStorage.getItem(FALLBACK_PREFIX + key); } catch { return null; }
}

function fallbackWrite(key: string, value: string): void {
  try { sessionStorage.setItem(FALLBACK_PREFIX + key, value); } catch { /* noop */ }
}

function fallbackRemove(key: string): void {
  try { sessionStorage.removeItem(FALLBACK_PREFIX + key); } catch { /* noop */ }
}

/**
 * 设置 Cookie 同意状态，并在模式切换时迁移已有登录态数据：
 *   allowed → declined：把现有 auth cookie 搬进 sessionStorage，再清除真实 cookie
 *   declined → accepted：把 sessionStorage 镜像刷盘到真实 cookie，再清 sessionStorage
 */
export function setCookieConsent(value: CookieConsent): void {
  const prev = _cookieConsent;
  _cookieConsent = value;
  _consentLoaded = true;
  try { localStorage.setItem(COOKIE_CONSENT_KEY, value); } catch { /* ignore */ }
  if (prev === value) return;

  if (value === 'declined') {
    // 把现有真实 cookie 搬到 sessionStorage
    for (const k of AUTH_COOKIE_KEYS) {
      const v = readDocumentCookie(k);
      if (v !== null) fallbackWrite(k, v);
      removeDocumentCookie(k);
    }
  } else if (value === 'accepted') {
    // 把 sessionStorage 镜像刷盘到真实 cookie
    for (const k of AUTH_COOKIE_KEYS) {
      const v = fallbackRead(k);
      if (v !== null) {
        writeDocumentCookie(k, v, AUTH_COOKIE_MAX_AGE);
        fallbackRemove(k);
      }
    }
  }
}

/* ── 低层 document.cookie 操作（不检查同意状态，仅供内部使用） ── */

function readDocumentCookie(key: string): string | null {
  if (typeof document === "undefined" || !document.cookie) return null;
  try {
    const parts = document.cookie.split("; ");
    for (const part of parts) {
      const idx = part.indexOf("=");
      if (idx === -1) continue;
      const name = decodeURIComponent(part.slice(0, idx));
      if (name === key) return decodeURIComponent(part.slice(idx + 1));
    }
    return null;
  } catch { return null; }
}

function writeDocumentCookie(key: string, value: string, maxAgeSec: number): void {
  if (typeof document === "undefined") return;
  try {
    const secure = typeof window !== "undefined" && window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${encodeURIComponent(key)}=${encodeURIComponent(value)}; path=/; max-age=${maxAgeSec}; SameSite=Lax${secure}`;
  } catch { /* noop */ }
}

function removeDocumentCookie(key: string): void {
  if (typeof document === "undefined") return;
  try {
    document.cookie = `${encodeURIComponent(key)}=; path=/; max-age=0; SameSite=Lax`;
  } catch { /* noop */ }
}

/* ── 同意状态感知的公共 Cookie API ── */

/** 读取 cookie（declined 模式下读 sessionStorage 镜像，否则读 document.cookie） */
export function readCookie(key: string): string | null {
  if (!hasCookieConsent()) {
    const v = fallbackRead(key);
    if (v !== null) return v;
  }
  return readDocumentCookie(key);
}

/** 写入 cookie（declined → 写 sessionStorage 镜像；已同意 → 写 document.cookie） */
export function writeCookie(key: string, value: string, maxAgeSec: number = AUTH_COOKIE_MAX_AGE): void {
  if (hasCookieConsent()) {
    fallbackRemove(key);
    writeDocumentCookie(key, value, maxAgeSec);
  } else {
    fallbackWrite(key, value);
  }
}

/** 删除 cookie（sessionStorage 镜像与 document.cookie 都清） */
export function removeCookie(key: string): void {
  fallbackRemove(key);
  removeDocumentCookie(key);
}

/** Reactive cookie 包装（语义与 useLocalStorage 对齐，供 auth store 使用） */
export function useCookieStorage<T = string>(key: string, fallback: T, maxAgeSec: number = AUTH_COOKIE_MAX_AGE): Ref<T> {
  const stored = readCookieValue<T>(key, fallback);
  const value = ref<T>(stored) as Ref<T>;

  // flush:'sync' 确保 ref 变化时 cookie 立即写入，避免 clearSession 中"先设值→后删 cookie→watch 才 flush 写回空值"的竞态，
  // 以及 login 后 watch 未 flush 就刷新页面导致 cookie 没写入的丢登录问题
  watch(value, (next) => {
    writeCookieValue(key, next, maxAgeSec);
  }, { deep: true, flush: 'sync' });

  return value;
}

/** 非响应式一次性读取 cookie（与 readLocalStorage 对齐） */
export function readCookieStorage<T = string>(key: string, fallback: T): T {
  return readCookieValue(key, fallback);
}

export function writeCookieStorage<T = string>(key: string, value: T, maxAgeSec: number = AUTH_COOKIE_MAX_AGE): void {
  writeCookieValue(key, value, maxAgeSec);
}

export function removeCookieStorage(key: string): void {
  removeCookie(key);
}

/* ── Cookie 内部序列化 helper（与 localStorage 分支逻辑一致） ── */

function readCookieValue<T>(key: string, fallback: T): T {
  const raw = readCookie(key);
  if (raw === null) return fallback;
  if (typeof fallback === "string") {
    try { return JSON.parse(raw) as T; } catch { return raw as unknown as T; }
  }
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

function writeCookieValue<T>(key: string, value: T, maxAgeSec: number): void {
  try {
    // 空值（null/undefined/空字符串/false）统一删除 cookie，避免写入空字符串 cookie
    // 导致刷新后 readCookie 返回 "" 而非 null，readCookieValue 误判为有效值
    if (value === null || value === undefined || value === "" || value === false) {
      removeCookie(key);
    } else if (typeof value === "string") {
      writeCookie(key, value, maxAgeSec);
    } else {
      writeCookie(key, JSON.stringify(value), maxAgeSec);
    }
  } catch { /* noop */ }
}

/** Reactive sessionStorage wrapper. */
export function useSessionStorage<T = string>(key: string, fallback: T): Ref<T> {
  const stored = readSessionStorage<T>(key, fallback);
  const value = ref<T>(stored) as Ref<T>;

  watch(value, (next) => {
    try { sessionStorage.setItem(key, JSON.stringify(next)); } catch { /* noop */ }
  }, { deep: true });

  return value;
}

export function readSessionStorage<T = string>(key: string, fallback: T): T {
  return readFrom(sessionStorage, key, fallback);
}

export function removeSessionStorage(key: string): void {
  try { sessionStorage.removeItem(key); } catch { /* noop */ }
}

/* ── Internal helpers ── */

function readStorage<T>(key: string, fallback: T): T {
  return readFrom(localStorage, key, fallback);
}

function writeStorage<T>(key: string, value: T): void {
  try {
    if (value === null || value === undefined) {
      localStorage.removeItem(key);
    } else if (typeof value === "string") {
      localStorage.setItem(key, value);
    } else {
      localStorage.setItem(key, JSON.stringify(value));
    }
  } catch { /* noop */ }
}

function readFrom<T>(store: Storage, key: string, fallback: T): T {
  try {
    const raw = store.getItem(key);
    if (raw === null) return fallback;
    if (typeof fallback === "string") {
      try { return JSON.parse(raw) as T; } catch { return raw as unknown as T; }
    }
    try { return JSON.parse(raw) as T; } catch { return fallback; }
  } catch {
    return fallback;
  }
}

