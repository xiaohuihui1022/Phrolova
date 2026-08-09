import type { Router } from "vue-router";
import { computed, reactive, ref, shallowRef } from "vue";
import axios from "axios";
import {
  registerAdminAuthExpiredCallback,
  markAdmin,
  clearAdmin,
} from "@/api/authSession";
import { errMsg } from "@/api/client";
import { useToast } from "@/composables/useToast";

const TOKEN_KEY = "admin_token";

export interface AdminTokenPayload {
  username: string;
  expiry: number;
}

export function parseAdminToken(token: string | null): AdminTokenPayload | null {
  if (!token) return null;
  try {
    const parts = token.split(":");
    if (parts.length < 3) return null;
    const username = parts[1];
    const createdAt = parseInt(parts[2], 10);
    if (!username || Number.isNaN(createdAt)) return null;
    const sessionTtlSec = 7200;
    return { username, expiry: createdAt + sessionTtlSec };
  } catch {
    return null;
  }
}

export function isAdminTokenExpired(token: string | null): boolean {
  const p = parseAdminToken(token);
  if (!p) return true;
  return Date.now() >= (p.expiry + 60) * 1000;
}

const adminToken = shallowRef<string | null>(localStorage.getItem(TOKEN_KEY));
const authLoading = ref(false);
const authError = ref("");

const loginForm = reactive({ username: "", password: "" });

const isAdmin = computed(() => !!adminToken.value && !isAdminTokenExpired(adminToken.value));
const adminUsername = computed(() => parseAdminToken(adminToken.value)?.username ?? "");

const toast = useToast();

export function setAdminToken(token: string | null) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
    markAdmin();
  } else {
    localStorage.removeItem(TOKEN_KEY);
    clearAdmin();
  }
  adminToken.value = token;
}

export function clearAdminToken() {
  setAdminToken(null);
}

let _router: Router | null = null;
export function bindAdminRouter(router: Router) {
  _router = router;
}

/**
 * 管理员 401 回调：client.ts 的 ADMIN_AUTH_REQUIRED 分支会通过 authSession 调用本函数。
 *   - 清 token
 *   - 跳登录页（带 redirect）
 */
function onAdminAuthExpired() {
  clearAdminToken();
  toast.error("管理员登录已过期，请重新登录", { autoClose: true, duration: 4000 });
  if (_router) {
    const redirect = _router.currentRoute.value.fullPath;
    _router.replace({ name: "admin-login", query: { redirect } });
  }
}

// 注册回调（幂等）
registerAdminAuthExpiredCallback(onAdminAuthExpired);

/**
 * @deprecated 过渡期保留：管理员 headers 注入现在由 client.ts 请求拦截器统一处理，
 *             业务层不再拼 headers。致谢页面已改签名，老调用方迁移完可删。
 */
export function adminHeaders(): Record<string, string> {
  const t = adminToken.value ?? localStorage.getItem(TOKEN_KEY) ?? "";
  return { "X-Admin-Token": t };
}

export async function doAdminLogin(): Promise<boolean> {
  authLoading.value = true;
  authError.value = "";
  try {
    const resp = await axios.request<{ status: string; token?: string; message?: string; error_code?: string }>({
      method: "POST",
      url: "/admin/login",
      baseURL: import.meta.env.VITE_API_BASE || "/api",
      headers: { "Content-Type": "application/json" },
      data: {
        username: loginForm.username.trim(),
        password: loginForm.password,
      },
      timeout: 15000,
      validateStatus: () => true,
    });
    const data = resp.data ?? {};
    if (resp.status >= 200 && resp.status < 300 && data.status === "success" && data.token) {
      setAdminToken(data.token);
      return true;
    }
    authError.value = data.message || (resp.status === 401 ? "用户名或密码错误" : "登录失败");
    return false;
  } catch (e) {
    authError.value = errMsg(e);
    return false;
  } finally {
    authLoading.value = false;
  }
}

export async function doAdminLogout() {
  try {
    const t = adminToken.value ?? localStorage.getItem(TOKEN_KEY) ?? "";
    await axios.request({
      method: "POST",
      url: "/admin/logout",
      baseURL: import.meta.env.VITE_API_BASE || "/api",
      headers: t ? { "X-Admin-Token": t, "Content-Type": "application/json" } : { "Content-Type": "application/json" },
      timeout: 15000,
      validateStatus: () => true,
    });
  } catch {
    /* best-effort */
  } finally {
    clearAdminToken();
  }
}

/**
 * @deprecated 过渡期保留：管理员 401 现在由 client.ts 拦截器 + registerAdminAuthExpiredCallback 统一处理。
 *             老调用方的 try/catch 中若仍使用 handleAdminApiError，逻辑等价（兼容）。
 */
export function handleAdminApiError(e: unknown, currentPath?: string): boolean {
  const code: string | undefined =
    (e as any)?.error_code ??
    (e as any)?.response?.data?.error_code ??
    undefined;
  const status: number | undefined = (e as any)?.response?.status;
  const admin401 =
    status === 401 &&
    (!code || code === "ADMIN_AUTH_REQUIRED");
  if (admin401) {
    onAdminAuthExpired();
    if (currentPath && _router) {
      _router.replace({ name: "admin-login", query: { redirect: currentPath } });
    }
    return true;
  }
  return false;
}

export function useAdmin() {
  return {
    adminToken,
    isAdmin,
    adminUsername,
    authLoading,
    authError,
    loginForm,
    adminHeaders,
    doLogin: doAdminLogin,
    doLogout: doAdminLogout,
    setToken: setAdminToken,
    clearToken: clearAdminToken,
  };
}
