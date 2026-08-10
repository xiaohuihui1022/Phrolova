// 原生 WebSocket 连接层（对齐 csgofriberg socket.ts 连接管理模式，协议保持项目原生 JSON-over-WS）
//   - GameWebSocket 类：基础连接 + 超时 + 自动重连
//   - 多 path 单例 Map + 引用计数：避免 matchmaker / room 同时连接时重复实例
//   - AUTH_EXPIRED / PLAYER_NOT_FOUND：通过事件钩子触发业务层身份恢复（例如 HTTP 侧 refresh）
//   - 连接失败阈值 toast 策略：>=3 次未成功建立连接，抛一次性"连接异常" toast（id 合并，不刷屏）

import {
  hasAuthHint,
  refreshAuthenticatedSession,
  clearAuthenticated,
  registerPostRefreshHook,
} from './authSession';
import { useToast } from '@/composables/useToast';
import { readCookie } from '@/composables/useStorage';

export type WsMessage = {
  type: string;
  payload: Record<string, unknown>;
  /** 后端 S2C.ERROR 消息会带 error_code（例如 AUTH_EXPIRED、PLAYER_NOT_FOUND） */
  error_code?: string;
};

const PLAYER_ID_KEY = 'phrolova_player_id';
const PLAYER_TOKEN_KEY = 'phrolova_player_token';
const FAIL_THRESHOLD = 3;
const TOAST_FAIL_ID = '__ws_connect_fail__';

const toast = useToast();

// ── WebSocket 客户端封装 ──
export class GameWebSocket {
  private ws: WebSocket | null = null;
  private url: string;
  private playerId: string;
  private token: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 50;
  private reconnectDelay = 1000;
  private intentionalClose = false;
  /** 会话建立过程中，首次失败计数（用户可见：>= FAIL_THRESHOLD 时 toast 一次） */
  private preconnectFailCount = 0;
  /** 历史上是否曾成功 onopen（区分首连失败与中途断开） */
  private everOpened = false;

  onMessage: ((data: WsMessage) => void) | null = null;
  onOpen: (() => void) | null = null;
  onClose: (() => void) | null = null;
  onError: ((error: Event) => void) | null = null;

  constructor(baseUrl: string, playerId: string, token: string) {
    this.url = baseUrl;
    this.playerId = playerId;
    this.token = token;
  }

  connect(path: string = ''): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.preconnectFailCount = 0;
        resolve();
        return;
      }

      this.intentionalClose = false;
      const fullUrl = this.buildUrl(path);
      let didOpen = false;
      let settled = false;

      const timeoutId = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.intentionalClose = true;
          try { this.ws?.close(); } catch { /* ignore */ }
          this._bumpPreconnectFail('连接超时，请重试');
          reject(new Error('连接超时，请重试'));
        }
      }, 10000);

      try {
        this.ws = new WebSocket(fullUrl);
      } catch (e) {
        clearTimeout(timeoutId);
        this._bumpPreconnectFail('WebSocket 初始化失败');
        reject(e);
        return;
      }

      this.ws.onopen = () => {
        if (settled) return;
        clearTimeout(timeoutId);
        didOpen = true;
        this.everOpened = true;
        this.reconnectAttempts = 0;
        // 连上了 → 清理之前积累的"未连接成功"阈值计数 + 对应 toast（如果有）
        this.preconnectFailCount = 0;
        try { toast.dismiss(TOAST_FAIL_ID as any); } catch { /* ignore */ }
        this.onOpen?.();
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string) as WsMessage;
          if (data?.type) {
            this.onMessage?.(data);
          }
        } catch {
          // 忽略非 JSON 消息
        }
      };

      this.ws.onerror = (event) => {
        this.onError?.(event);
      };

      this.ws.onclose = () => {
        clearTimeout(timeoutId);
        this.onClose?.();

        // 从未成功打开 → 连接失败
        if (!didOpen) {
          if (!settled) {
            settled = true;
            this._bumpPreconnectFail('WebSocket 连接失败，请检查网络或服务状态');
            reject(new Error('WebSocket 连接失败，请检查网络或服务状态'));
          }
          return;
        }

        // 曾成功打开 → 自动重连（原策略保持）
        if (!this.intentionalClose && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
          setTimeout(() => {
            this.connect(path).catch(() => {
              // 重连失败：静默，靠 onClose/下一次 onclose 再触发
            });
          }, delay);
        } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          toast.warn('多人模式重连次数已达上限，请刷新页面或稍后重试', { id: TOAST_FAIL_ID as any, autoClose: true, duration: 6000 });
        }
      };
    });
  }

  private _bumpPreconnectFail(msg: string) {
    if (this.everOpened) return;
    this.preconnectFailCount++;
    if (this.preconnectFailCount >= FAIL_THRESHOLD) {
      toast.error(`多人模式${msg}，请检查网络或稍后重试`, { id: TOAST_FAIL_ID as any, autoClose: true, duration: 5000 });
    }
  }

  private buildUrl(path: string): string {
    const params = new URLSearchParams({
      playerId: this.playerId,
      token: this.token,
    });
    return `${this.url}${path}?${params.toString()}`;
  }

  send(type: string, payload: unknown = {}): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
    }
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.onopen = null;
      this.ws.close();
      this.ws = null;
    }
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  updateCredentials(playerId: string, token: string): void {
    this.playerId = playerId;
    this.token = token;
  }
}

export function getWsBaseUrl(): string {
  const envBase = import.meta.env.VITE_WS_URL;
  if (envBase) return envBase;
  const dev = import.meta.env.DEV;
  if (dev) return `ws://${window.location.host}`;
  const { protocol, host } = window.location;
  return protocol === 'https:' ? `wss://${host}` : `ws://${host}`;
}

// ── 单例 + 引用计数 ──────────────────────────────────────────────────
type Entry = { ws: GameWebSocket; ref: number; path: string };
const _registry = new Map<string, Entry>();
/** 按 path 并发去重：未完成 connect 的 Promise 复用 */
const _connectingTasks = new Map<string, Promise<GameWebSocket>>();

function readLocalCreds(): { playerId: string; token: string } | null {
  try {
    const pid = readCookie(PLAYER_ID_KEY) ?? '';
    const tok = readCookie(PLAYER_TOKEN_KEY) ?? '';
    if (pid && tok) return { playerId: pid, token: tok };
    return null;
  } catch { return null; }
}

/**
 * 获取指定 path 的 GameWebSocket 单例（并发去重 + 引用计数）
 *   - path: 形如 "/ws/matchmaker" 或 "/ws/room/ABCD1234"
 *   - onMessage/onOpen/onClose/onError 会覆盖旧回调（单例语义：同一时刻同一 path 只服务一个 store）
 */
export async function getGameSocket(
  path: string,
  handlers: Partial<Pick<GameWebSocket, 'onMessage' | 'onOpen' | 'onClose' | 'onError'>>,
): Promise<GameWebSocket> {
  const existing = _registry.get(path);
  if (existing) {
    existing.ref++;
    if (handlers.onMessage) existing.ws.onMessage = handlers.onMessage;
    if (handlers.onOpen) existing.ws.onOpen = handlers.onOpen;
    if (handlers.onClose) existing.ws.onClose = handlers.onClose;
    if (handlers.onError) existing.ws.onError = handlers.onError;
    if (existing.ws.connected) return existing.ws;
    // 已存在但未 connected → 复用并发 Promise 或新建
    const pending = _connectingTasks.get(path);
    if (pending) return pending;
    const task = existing.ws.connect(path).then(() => existing.ws);
    _connectingTasks.set(path, task);
    try { return await task; } finally { _connectingTasks.delete(path); }
  }

  // 无实例：先检查本地凭证
  const creds = readLocalCreds();
  if (!creds) throw new Error('请先登录账号，再进入多人模式');

  const pending = _connectingTasks.get(path);
  if (pending) return pending;

  const task = (async () => {
    const baseUrl = getWsBaseUrl();
    const ws = new GameWebSocket(baseUrl, creds.playerId, creds.token);
    if (handlers.onMessage) ws.onMessage = handlers.onMessage;
    if (handlers.onOpen) ws.onOpen = handlers.onOpen;
    if (handlers.onClose) ws.onClose = handlers.onClose;
    if (handlers.onError) ws.onError = handlers.onError;
    await ws.connect(path);
    _registry.set(path, { ws, ref: 1, path });
    return ws;
  })();
  _connectingTasks.set(path, task);
  try { return await task; } finally { _connectingTasks.delete(path); }
}

/** 释放指定 path 的引用计数，计数归零则断开并移除单例 */
export function releaseGameSocket(path: string): void {
  const entry = _registry.get(path);
  if (!entry) return;
  entry.ref--;
  if (entry.ref <= 0) {
    entry.ws.disconnect();
    _registry.delete(path);
    try { toast.dismiss(TOAST_FAIL_ID as any); } catch { /* ignore */ }
  }
}

/** 断开所有单例（用户退出登录/页面卸载用） */
export function closeGameSocketAll(): void {
  for (const entry of Array.from(_registry.values())) {
    entry.ws.disconnect();
  }
  _registry.clear();
  _connectingTasks.clear();
  try { toast.dismiss(TOAST_FAIL_ID as any); } catch { /* ignore */ }
}

/**
 * WS 身份恢复：收到 AUTH_EXPIRED 或 PLAYER_NOT_FOUND 时调用
 *   - AUTH_EXPIRED → 调用 HTTP refreshAuthenticatedSession（已单例去重）→ 成功后更新该 path 单例的 credentials + 主动通知上层重连/发送一次 ping 复用
 *   - PLAYER_NOT_FOUND → 清 hint，toast 并通知 authStore 清状态（通过 CustomEvent）
 * @returns 是否恢复成功；失败时调用方通常应该断开/跳登录
 */
export async function recoverSessionIfNeeded(path: string, code: string): Promise<boolean> {
  if (code === 'AUTH_EXPIRED' && hasAuthHint()) {
    try {
      const ok = await refreshAuthenticatedSession(false);
      if (!ok) {
        clearAuthenticated();
        try { window.dispatchEvent(new CustomEvent('phrolova:session-cleared')); } catch { /* ignore */ }
        toast.error('登录状态已过期，请重新登录', { id: -2, autoClose: true, duration: 4000 });
        return false;
      }
      const creds = readLocalCreds();
      if (!creds) return false;
      const entry = _registry.get(path);
      if (entry) entry.ws.updateCredentials(creds.playerId, creds.token);
      try { window.dispatchEvent(new CustomEvent('phrolova:ws-session-recovered')); } catch { /* ignore */ }
      toast.success('连接已恢复', { id: -3, autoClose: true, duration: 1800 });
      return true;
    } catch {
      return false;
    }
  }
  if (code === 'PLAYER_NOT_FOUND' || code === 'AUTH_REQUIRED') {
    clearAuthenticated();
    try { window.dispatchEvent(new CustomEvent('phrolova:session-cleared')); } catch { /* ignore */ }
    toast.error(code === 'PLAYER_NOT_FOUND' ? '当前账号不存在或已重置，请重新登录' : '请先登录', { id: -4, autoClose: true, duration: 4000 });
    return false;
  }
  return true;
}

/**
 * 与恢复链路配套：WS S2C.ERROR 解析 helper
 *   用途：multiGame.ts onMessage 遇到 S2C.ERROR 时，先 tryRecoverOnWsError()；
 *        返回 true 说明已自动处理（已 toat 或将自动刷新），业务层可不再弹 error banner
 */
export async function tryRecoverOnWsError(
  path: string,
  errorPayload: Record<string, unknown>,
): Promise<'handled' | 'pass'> {
  const code = String(errorPayload.error_code ?? errorPayload.code ?? '');
  if (!code) return 'pass';
  if (code === 'AUTH_EXPIRED' || code === 'PLAYER_NOT_FOUND' || code === 'AUTH_REQUIRED') {
    await recoverSessionIfNeeded(path, code);
    return 'handled';
  }
  return 'pass';
}

/**
 * HTTP 侧 refresh 完成后同步所有活动 WS 单例的凭证（供 authSession 调用的 hook，可选）
 *   例如玩家在多标签页 refresh token 轮换，其他 tab 的 WS 也要更新凭证，避免下一次 onclose 重连时用旧 token。
 */
export function syncCredentialsForAllSockets(): void {
  const creds = readLocalCreds();
  if (!creds) return;
  for (const entry of _registry.values()) {
    entry.ws.updateCredentials(creds.playerId, creds.token);
  }
}

/**
 * 在途 refresh 后，让所有活动 WS 单例利用最新凭证"强制重连一次"（可选，由业务层决定）
 *   注意：GameWebSocket.connect() 在 OPEN 时是 no-op；因此这里先 disconnect。如果用户真的在进行中房间，
 *   应当手动让上层 ROOM_STATE 等待 ROOM_STATE 同步后再继续。默认不自动调用，避免打断当前操作。
 */
export function forceReconnectAllSockets(): void {
  for (const [path, entry] of Array.from(_registry.entries())) {
    const handlers = {
      onMessage: entry.ws.onMessage,
      onOpen: entry.ws.onOpen,
      onClose: entry.ws.onClose,
      onError: entry.ws.onError,
    };
    entry.ws.disconnect();
    // 异步重连（不等待，复用 getGameSocket 语义）
    getGameSocket(path, handlers).catch(() => { /* ignore */ });
  }
}

// authSession 可选回调：refresh 成功后把所有 WS 单例的 credentials 同步刷新
//   通过直接 import registerPostRefreshHook 注册（单向依赖，安全无循环）
if (typeof window !== 'undefined') {
  try {
    registerPostRefreshHook(syncCredentialsForAllSockets);
  } catch { /* ignore */ }
}
