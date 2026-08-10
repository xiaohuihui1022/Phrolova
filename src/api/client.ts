import axios, { AxiosError } from 'axios';
import {
  hasAuthHint,
  hasAdminHint,
  refreshAuthenticatedSession,
  clearAuthenticated,
  invokeAdminAuthExpired,
} from './authSession';
import { useToast } from '@/composables/useToast';
import { readCookie } from '@/composables/useStorage';

// NOTE: 循环依赖安全：client.ts → authSession.ts（✅ 单向，authSession 不回 import client）
//       useToast 是 composable 单例，值类型安全
//       admin expired 通过 registerAdminAuthExpiredCallback（authSession 持有闭包），不回引 useAdmin
//
//       AxiosError.isAxiosError ❌ 错！axios v1.x 里 isAxiosError 是模块顶层函数，不是 AxiosError 静态方法。
//       统一：用 axios.isAxiosError(err) 来判定
const isAxiosError = axios.isAxiosError.bind(axios);

const toast = useToast();

/** 从 Cookie 取玩家当前凭证（与 authStore 的 useCookieStorage key 对齐） */
const PLAYER_ID_KEY = 'phrolova_player_id';
const PLAYER_TOKEN_KEY = 'phrolova_player_token';
const ADMIN_TOKEN_KEY = 'admin_token';

declare module 'axios' {
  interface AxiosRequestConfig {
    _authRetried?: boolean;
    _adminRetried?: boolean;
  }
}

/** 经过拦截器解包后的 api 客户端：方法返回 T 而非 AxiosResponse<T> */
type UnwrappedAxios = Omit<import('axios').AxiosInstance, 'request'|'get'|'delete'|'head'|'options'|'post'|'put'|'patch'> & {
  request<T = any, D = any>(config: import('axios').AxiosRequestConfig<D>): Promise<T>;
  get<T = any, D = any>(url: string, config?: import('axios').AxiosRequestConfig<D>): Promise<T>;
  delete<T = any, D = any>(url: string, config?: import('axios').AxiosRequestConfig<D>): Promise<T>;
  head<T = any, D = any>(url: string, config?: import('axios').AxiosRequestConfig<D>): Promise<T>;
  options<T = any, D = any>(url: string, config?: import('axios').AxiosRequestConfig<D>): Promise<T>;
  post<T = any, D = any>(url: string, data?: D, config?: import('axios').AxiosRequestConfig<D>): Promise<T>;
  put<T = any, D = any>(url: string, data?: D, config?: import('axios').AxiosRequestConfig<D>): Promise<T>;
  patch<T = any, D = any>(url: string, data?: D, config?: import('axios').AxiosRequestConfig<D>): Promise<T>;
};

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || '/api',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
}) as unknown as UnwrappedAxios;

// ── 请求拦截器：统一注入玩家/管理员 headers + 请求 ID ──────────────
api.interceptors.request.use((config) => {
  // 请求级 request id，方便在 Worker 日志 grep
  try {
    // @ts-ignore crypto 在现代浏览器可用
    const rid = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `rid_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    config.headers.set('X-Request-Id', String(rid));
  } catch { /* ignore */ }

  if (hasAuthHint()) {
    try {
      const pid = readCookie(PLAYER_ID_KEY) ?? '';
      const tok = readCookie(PLAYER_TOKEN_KEY) ?? '';
      if (pid && tok) {
        config.headers.set('X-Player-Id', pid);
        config.headers.set('X-Player-Token', tok);
        config.headers.set('X-Auth-Expected', '1');
      }
    } catch { /* ignore */ }
  } else {
    try { config.headers.delete('X-Auth-Expected'); } catch { /* ignore */ }
  }

  if (hasAdminHint()) {
    try {
      const at = readCookie(ADMIN_TOKEN_KEY) ?? '';
      if (at) config.headers.set('X-Admin-Token', at);
    } catch { /* ignore */ }
  }
  return config;
});

// ── 响应拦截器：成功解包 + 业务错误降级 + 401 透明重试 ────────────
api.interceptors.response.use(
  (response) => {
    const data = response.data;
    if (data && typeof data === 'object' && data.status === 'error') {
      // HTTP 200 但业务失败（实际上罕见，因为后端 error() 都非 200）→ 合成 axios error 走 catch
      const synthetic = new AxiosError(
        String(data.message ?? 'Request failed'),
        AxiosError.ERR_BAD_RESPONSE,
        response.config,
        response.request,
        response,
      );
      return Promise.reject(synthetic);
    }
    // 与 requestJson 返回层级一致：直接返回 data（{ status, ...payload }）
    return data;
  },
  async (error) => {
    if (!isAxiosError(error)) throw error;
    const config = error.config;
    if (!config) throw error;

    const respData = (error.response?.data ?? {}) as Record<string, unknown>;
    const errorCode = String(respData.error_code ?? respData.code ?? '');
    const httpStatus = error.response?.status ?? 0;

    // ══════ 玩家 401：透明 refresh + 重放（只重试 1 次） ══════
    if (
      httpStatus === 401 &&
      (errorCode === 'AUTH_EXPIRED') &&
      !config._authRetried &&
      hasAuthHint()
    ) {
      config._authRetried = true;
      let refreshNetworkFailed = false;
      try {
        const ok = await refreshAuthenticatedSession(false);
        if (ok) {
          // refresh 成功 → 重放原请求
          // 注意：refreshAuthenticatedSession 已经把新 token 写入 Cookie，
          //       而 api.request 会再次走请求拦截器，重新从 Cookie 读 header，
          //       所以这里不用手动更新 config.headers
          return api.request(config as any);
        }
        // refresh 返回 false = 后端明确 401（认证失败）→ 清 hint，抛原 401
        clearAuthenticated();
      } catch (refreshErr) {
        // refresh 抛错：区分网络错误 vs 认证错误
        // 网络错误（无 response）不应判定为认证失败，否则刷新页面时瞬断会导致掉登录
        const rStatus = (refreshErr as any)?.response?.status ?? 0;
        const rIsNetwork = rStatus === 0 || (refreshErr as any)?.code === 'ERR_NETWORK';
        if (rIsNetwork) {
          refreshNetworkFailed = true;
          // 不清 hint，保留登录态，让用户网络恢复后重试
        } else {
          clearAuthenticated();
        }
      }
      if (refreshNetworkFailed) {
        // refresh 因网络失败：抛网络错误而非原 401，避免 hydrate 误判为认证失败清会话
        const wrapped = new AxiosError(
          'NETWORK_ERROR',
          AxiosError.ERR_NETWORK,
          error.config,
          error.request,
          undefined,
        );
        (wrapped as any).error_code = 'NETWORK_ERROR';
        throw wrapped;
      }
      throw error;
    }

    // ══════ 玩家 401 AUTH_REQUIRED ══════
    if (httpStatus === 401 && errorCode === 'AUTH_REQUIRED' && !config._authRetried) {
      // 用户本来就不该带登录态，不刷新，直接抛
      clearAuthenticated();
      throw error;
    }

    // ══════ 管理员 401：统一跳登录页 ══════
    if (
      httpStatus === 401 &&
      (errorCode === 'ADMIN_AUTH_REQUIRED') &&
      !config._adminRetried &&
      hasAdminHint()
    ) {
      config._adminRetried = true;
      invokeAdminAuthExpired();
      throw error;
    }

    // ══════ 网络失败/超时（无 response）→ toast 一次性提示 + 抛标准化错误 ══════
    if (!error.response) {
      // 不重复 toast 同一错误（这里无法稳定区分"同时两个请求都超时"，但 NETWORK_ERROR 对用户是同一个概念，
      //   给个固定 id 让 toast 层合并）
      toast.error('网络连接失败，请检查网络后重试', { id: -1, autoClose: true, duration: 4000 });
      const wrapped = new AxiosError(
        'NETWORK_ERROR',
        AxiosError.ERR_NETWORK,
        error.config,
        error.request,
        undefined,
      );
      (wrapped as any).error_code = 'NETWORK_ERROR';
      throw wrapped;
    }

    // ══════ 其他 HTTP 错误：原样抛出，保留 error_code ══════
    (error as any).error_code = errorCode || undefined;
    throw error;
  },
);

/**
 * 统一错误码 → 用户可读文案
 *   调用面：页面 try/catch 统一 errMsg(reason)；其他 composables 也可直接用
 */
export function errMsg(err: unknown): string {
  if (isAxiosError(err)) {
    const code = String((err as any).error_code ?? (err.response?.data as Record<string, unknown> | undefined)?.error_code ?? '');
    // 优先级 1：error_code 映射表（错误码唯一来源，不翻译多语言）
    const mapped = CODE_MESSAGE[code];
    if (mapped) return mapped;
    // 优先级 2：后端 message 字段（业务错误如"验证码错误或已过期"）
    const backendMsg = (err.response?.data as Record<string, unknown> | undefined)?.message;
    if (typeof backendMsg === 'string' && backendMsg.length) return backendMsg;
    // 优先级 3：网络错误兜底
    if (!err.response) return '网络连接失败，请检查网络后重试';
    // 优先级 4：默认
    return '请求失败，请稍后重试';
  }
  if (err instanceof Error && err.message) return err.message;
  return '请求失败';
}

const CODE_MESSAGE: Record<string, string> = {
  NETWORK_ERROR: '网络连接失败，请检查网络后重试',
  AUTH_EXPIRED: '登录状态已过期，请重新登录',
  AUTH_REQUIRED: '请先登录',
  ADMIN_AUTH_REQUIRED: '管理员登录已过期，请重新登录',
  SCRYPT_UNAVAILABLE: '当前环境不支持旧密码验证，请重置密码',
  INTERNAL_ERROR: '服务器内部错误，请稍后重试',
};
