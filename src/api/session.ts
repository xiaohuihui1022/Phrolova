import axios from 'axios';
import { hasAuthHint, clearAuthenticated } from './authSession';
import { errMsg } from './client';
import { useToast } from '@/composables/useToast';
import { readCookie } from '@/composables/useStorage';

const PLAYER_ID_KEY = 'phrolova_player_id';
const PLAYER_TOKEN_KEY = 'phrolova_player_token';

/** 模块级单例：防止并发重复初始化 */
let _initTask: Promise<void> | null = null;

const toast = useToast();

/**
 * 保证身份：有 hint 直接 resolve；无 hint → 返回（匿名模式）
 *   向后兼容：老匿名开局逻辑不在此处做任何网络调用（由调用方自己 initPlayer）
 */
export function ensureIdentity(): void {
  // 空实现：仅作占位
}

/**
 * 应用启动时调用一次：按 hint 决定拉 /auth/me 或 清残留
 *   - 模块级 Promise 去重
 *   - 通过 CustomEvent 通知 stores/auth.ts 同步 store（避免循环依赖）
 */
export function initializeIdentity(): Promise<void> {
  if (_initTask) return _initTask;
  const task: Promise<void> = (async () => {
    try {
      if (hasAuthHint()) {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        try {
          const pid = readCookie(PLAYER_ID_KEY) ?? '';
          const tok = readCookie(PLAYER_TOKEN_KEY) ?? '';
          if (pid && tok) {
            headers['X-Player-Id'] = pid;
            headers['X-Player-Token'] = tok;
          }
        } catch { /* ignore */ }
        const res = await axios.request<{
          status: string;
          player?: Record<string, unknown>;
          message?: string;
          error_code?: string;
        }>({
          method: 'GET',
          url: '/auth/me',
          baseURL: import.meta.env.VITE_API_BASE || '/api',
          headers,
          timeout: 15000,
          validateStatus: () => true,
        });
        const data = res.data ?? {};
        if (res.status >= 200 && res.status < 300 && data.status === 'success' && data.player) {
          try {
            window.dispatchEvent(new CustomEvent('phrolova:session-identity', {
              detail: { player: data.player },
            }));
          } catch { /* ignore */ }
          return;
        }
        const code = String(data.error_code ?? '');
        if (res.status === 401 || code === 'AUTH_EXPIRED' || code === 'AUTH_REQUIRED') {
          clearAuthenticated();
          try { window.dispatchEvent(new CustomEvent('phrolova:session-cleared')); } catch { /* ignore */ }
          toast.error(errMsg(Object.assign(new Error(data.message || '登录状态已过期，请重新登录'), {
            response: { data: { error_code: code || 'AUTH_EXPIRED' } },
          })));
          return;
        }
        // 其他失败（5xx 等）→ toast，但保留 hint（不强制清）
        toast.error(data.message || '身份初始化失败，请稍后刷新页面');
        return;
      }
      // 无 hint → 清残留并通知 store
      try {
        window.dispatchEvent(new CustomEvent('phrolova:session-cleared'));
      } catch { /* ignore */ }
    } catch (e) {
      try {
        toast.error(errMsg(e));
      } catch { /* ignore */ }
    } finally {
      _initTask = null;
      try {
        window.dispatchEvent(new CustomEvent('phrolova:session-initialized'));
      } catch { /* ignore */ }
    }
  })();
  _initTask = task;
  return task;
}
