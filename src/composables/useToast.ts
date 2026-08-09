import { reactive, readonly } from 'vue';

export type ToastType = 'success' | 'error' | 'info' | 'warn';

export interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
  /** error 默认不自动关闭；success/info 默认 3.5s 自动关闭 */
  autoClose?: boolean;
  /** 关闭时间毫秒数，默认 3500 */
  duration?: number;
  createdAt: number;
}

let _counter = 0;
const _items = reactive<ToastItem[]>([]);
const _timers = new Map<number, ReturnType<typeof setTimeout>>();

function _scheduleDismiss(id: number, duration: number) {
  const existing = _timers.get(id);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => _dismissInternal(id), duration);
  _timers.set(id, t);
}

function _dismissInternal(id: number) {
  const idx = _items.findIndex(i => i.id === id);
  if (idx >= 0) _items.splice(idx, 1);
  const t = _timers.get(id);
  if (t) {
    clearTimeout(t);
    _timers.delete(id);
  }
}

function push(item: Omit<ToastItem, 'id' | 'createdAt'> & { id?: number }): number {
  const id = item.id ?? ++_counter;
  // 同 id 已存在 → 先移除再插入（更新 message）
  const existingIdx = _items.findIndex(i => i.id === id);
  if (existingIdx >= 0) _items.splice(existingIdx, 1);
  const autoClose = item.autoClose ?? (item.type !== 'error');
  const duration = item.duration ?? 3500;
  const newItem: ToastItem = {
    id,
    type: item.type,
    message: item.message,
    autoClose,
    duration,
    createdAt: Date.now(),
  };
  _items.push(newItem);
  if (autoClose) _scheduleDismiss(id, duration);
  return id;
}

export interface ToastApi {
  items: readonly ToastItem[];
  success(message: string, opts?: { id?: number; autoClose?: boolean; duration?: number }): number;
  error(message: string, opts?: { id?: number; autoClose?: boolean; duration?: number }): number;
  info(message: string, opts?: { id?: number; autoClose?: boolean; duration?: number }): number;
  warn(message: string, opts?: { id?: number; autoClose?: boolean; duration?: number }): number;
  dismiss(id: number): void;
  clear(): void;
}

const toastApi: ToastApi = {
  items: readonly(_items),
  success(message, opts = {}) {
    return push({ type: 'success', message, id: opts.id, autoClose: opts.autoClose, duration: opts.duration });
  },
  error(message, opts = {}) {
    return push({
      type: 'error',
      message,
      id: opts.id,
      autoClose: opts.autoClose,
      duration: opts.duration,
    });
  },
  info(message, opts = {}) {
    return push({ type: 'info', message, id: opts.id, autoClose: opts.autoClose, duration: opts.duration });
  },
  warn(message, opts = {}) {
    return push({ type: 'warn', message, id: opts.id, autoClose: opts.autoClose, duration: opts.duration });
  },
  dismiss(id) { _dismissInternal(id); },
  clear() {
    for (const t of _timers.values()) clearTimeout(t);
    _timers.clear();
    _items.splice(0, _items.length);
  },
};

/** 全局 toast 队列（App.vue 渲染层 + 拦截器 + socket.ts 共用） */
export function useToast() {
  return toastApi;
}
