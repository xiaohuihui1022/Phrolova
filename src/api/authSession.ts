import axios from 'axios';
import { readCookie, writeCookie, removeCookie } from '@/composables/useStorage';

const AUTH_HINT = 'phrolova_auth_hint';
const ADMIN_HINT = 'phrolova_admin_hint';
const OLD_PLAYER_ID_KEY = 'phrolova_player_id';
const OLD_PLAYER_TOKEN_KEY = 'phrolova_player_token';

/** 最小合法 token 长度（与后端 MIN_TOKEN_LEN=20 对齐） */
const MIN_TOKEN_LEN = 20;

let refreshRequest: Promise<boolean> | null = null;

type AdminAuthExpiredCb = () => void;
let _adminAuthExpiredCb: AdminAuthExpiredCb | null = null;

type PostRefreshHook = () => void;
const _postRefreshHooks: PostRefreshHook[] = [];

export function registerAdminAuthExpiredCallback(cb: AdminAuthExpiredCb): void {
  _adminAuthExpiredCb = cb;
}
export function invokeAdminAuthExpired(): boolean {
  if (!_adminAuthExpiredCb) return false;
  try { _adminAuthExpiredCb(); return true; } catch { return false; }
}

/** 注册 refresh 成功后的后置钩子（socket.ts 通过该 hook 更新所有 WS 单例的 credentials） */
export function registerPostRefreshHook(hook: PostRefreshHook): void {
  _postRefreshHooks.push(hook);
}
function runPostRefreshHooks(): void {
  for (const h of _postRefreshHooks) {
    try { h(); } catch { /* ignore */ }
  }
}

/**
 * 判断是否"存在玩家 token"
 *   优先读 hint（1 字节，快）；若 hint 缺但老 token 仍在 → 一次性补写 hint（无感升级）
 *   注意：仅返回"可能有登录态"，不保证 token 一定有效（过期会被拦截器走 refresh）
 */
export function hasAuthHint(): boolean {
  try {
    if (readCookie(AUTH_HINT) === '1') return true;
    const oldTok = readCookie(OLD_PLAYER_TOKEN_KEY);
    if (oldTok && oldTok.length >= MIN_TOKEN_LEN) {
      writeCookie(AUTH_HINT, '1');
      return true;
    }
  } catch { /* cookie 访问失败 */ }
  return false;
}

export function markAuthenticated(): void {
  try { writeCookie(AUTH_HINT, '1'); } catch { /* ignore */ }
}

export function clearAuthenticated(): void {
  try { removeCookie(AUTH_HINT); } catch { /* ignore */ }
}

export function hasAdminHint(): boolean {
  try { return readCookie(ADMIN_HINT) === '1'; } catch { return false; }
}

export function markAdmin(): void {
  try { writeCookie(ADMIN_HINT, '1'); } catch { /* ignore */ }
}

export function clearAdmin(): void {
  try { removeCookie(ADMIN_HINT); } catch { /* ignore */ }
}

/**
 * 触发一次会话刷新（单例 Promise 并发去重）
 *  - 若当前请求正在刷新：直接复用同一个 Promise
 *  - 成功 → true；刷新失败 401 → 清 hint 并 false；其他错误向外抛（由拦截器决定是否重试）
 *
 * 说明：
 *  - 真正的同步 authStore.token 的逻辑由调用方（client.ts 拦截器或 session）在 Promise 回调中做，
 *    因为这里不能循环依赖 @/api（authSession → client.ts 里的 api 实例）
 *  - 调用方式：api.interceptors 里 await refreshAuthenticatedSession() → 检查返回 true
 *    → 然后自己再从 api.interceptors 里调用 authStore.applyPlayer(newPlayer) + setToken(newToken)
 *    （因为 authStore 是 pinia store，也放在 authSession 循环依赖太严重）
 */
export async function refreshAuthenticatedSession(force = false): Promise<boolean> {
  if (!hasAuthHint()) return false;

  if (!force && refreshRequest) return refreshRequest;
  if (refreshRequest) return refreshRequest;

  const task: Promise<boolean> = (async () => {
    try {
      // 不直接 import @/api/client.ts，避免循环依赖：
      // client.ts (interceptors import authSession) -> authSession import client -> 死循环
      // 所以这里走 axios direct，但 url 相对路径在前端 dev/prod 都会走到同域 /api
      const res = await axios.request<{
        status: string;
        player?: Record<string, unknown>;
        token?: string;
        message?: string;
        error_code?: string;
      }>({
        method: 'POST',
        url: '/api/auth/refresh',
        // 请求 header 直接读当前 token（与拦截器一致，只是不从实例走防循环）
        headers: {
          'Content-Type': 'application/json',
          'X-Player-Id': readCookie(OLD_PLAYER_ID_KEY) ?? '',
          'X-Player-Token': readCookie(OLD_PLAYER_TOKEN_KEY) ?? '',
        },
        timeout: 15000,
        validateStatus: () => true, // 我们自己判 HTTP
      });

      const data = res.data ?? {};
      if (res.status >= 200 && res.status < 300 && data.status === 'success' && data.player && data.token) {
        // 成功：把新 token/player 写回 Cookie（applyPlayer 那层在 pinia 里调用时会通过 watcher 同步？
        //   不，这里直接把 token 写入 cookie，因为 authStore 用 useCookieStorage 代理）
        try {
          writeCookie(OLD_PLAYER_TOKEN_KEY, data.token);
          const pid = String((data.player as Record<string, unknown>).player_id ?? '');
          if (pid) writeCookie(OLD_PLAYER_ID_KEY, pid);
        } catch { /* ignore */ }
        markAuthenticated();

        // 把结果挂到全局，由拦截器回调同步 store
        // 使用 CustomEvent 机制避免循环依赖：authSession 广播 refresh 结果，
        // 由 stores/auth.ts 在初始化时订阅（最解耦）
        try {
          window.dispatchEvent(new CustomEvent('phrolova:session-refreshed', {
            detail: { player: data.player, token: data.token },
          }));
        } catch { /* ignore */ }
        runPostRefreshHooks();
        return true;
      }

      const code = String(data.error_code ?? '');
      if (res.status === 401 || code === 'AUTH_EXPIRED' || code === 'AUTH_REQUIRED') {
        // 只清 hint，不 dispatch session-cleared：避免 hydrate 期间的 refresh 失败
        // 触发 authStore clearSession 导致刷新掉登录。让调用方（拦截器/hydrate）决定后续行为。
        // token 确实无效时，由 socket.ts 的 WebSocket recoverSessionIfNeeded 触发 clearSession。
        clearAuthenticated();
        return false;
      }
      // 服务端 500 / 网络异常 / 其他 → 抛给调用方
      const msg = data.message ?? (res.statusText || 'Refresh failed');
      const err = new Error(msg) as Error & { status?: number; error_code?: string; response?: unknown };
      err.status = res.status;
      err.error_code = code || undefined;
      err.response = data;
      throw err;
    } catch (e) {
      if (axios.isAxiosError(e)) {
        const status = e.response?.status;
        const code = String((e.response?.data as Record<string, unknown> | undefined)?.error_code ?? '');
        if (status === 401 || code === 'AUTH_EXPIRED' || code === 'AUTH_REQUIRED') {
          // 同上：只清 hint，不 dispatch session-cleared，避免刷新掉登录
          clearAuthenticated();
          return false;
        }
      }
      throw e;
    } finally {
      refreshRequest = null;
    }
  })();

  refreshRequest = task;
  return task;
}
