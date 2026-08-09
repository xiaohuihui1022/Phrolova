import { computed, reactive, shallowRef, watch } from "vue";
import { defineStore } from "pinia";

import { useLocalStorage, removeLocalStorage } from "@/composables/useStorage";
import type { AuthResponse } from "@/types";
import * as api from "@/api";
import { markAuthenticated, clearAuthenticated } from "@/api/authSession";
import { errMsg } from "@/api/client";

export const useAuthStore = defineStore("auth", () => {
  const playerId = useLocalStorage("phrolova_player_id", "");
  const token = useLocalStorage("phrolova_player_token", "");
  const loggedIn = useLocalStorage("phrolova_logged_in", false);

  const loading = shallowRef(false);
  const error = shallowRef("");
  const stats = reactive({
    score: 0,
    wins: 0,
    matches: 0,
    single_resonator_score: 0,
    single_skeleton_score: 0,
  });

  const isAuthenticated = computed(() => loggedIn.value && Boolean(playerId.value) && Boolean(token.value));

  // ── 跟 authSession hint 对齐（用户/拦截器 refresh 成功后都保持 hint 同步） ──
  //   playerId/token 是 useLocalStorage，watch 响应式变化：是 refresh 写回、login、logout 导致。
  watch(
    () => ({ pid: playerId.value, tok: token.value }),
    ({ pid, tok }) => {
      if (pid && tok) markAuthenticated();
      else clearAuthenticated();
    },
    { immediate: true },
  );

  // 订阅 authSession 广播的 refresh/init 结果（解决循环依赖 authSession 不能直接 import store）
  if (typeof window !== 'undefined') {
    try {
      window.addEventListener('phrolova:session-refreshed', ((ev: Event) => {
        const detail = (ev as CustomEvent<{ player?: AuthResponse['player']; token?: string }>).detail ?? {};
        if (detail.player) applyPlayer(detail.player);
        if (detail.token) token.value = detail.token;
      }) as EventListener);
      window.addEventListener('phrolova:session-cleared', () => {
        clearSession();
      });
      window.addEventListener('phrolova:session-identity', ((ev: Event) => {
        const detail = (ev as CustomEvent<{ player?: AuthResponse['player'] }>).detail ?? {};
        if (detail.player) applyPlayer(detail.player);
      }) as EventListener);
      window.addEventListener('phrolova:session-initialized', () => {
        // initializeIdentity 结束，给 hydrate 兜底（若此时仍未加载 player 信息但 hasAuthHint，则按现有 strategy 不做操作）
      });
    } catch { /* ignore */ }
  }

  function applyPlayer(player?: AuthResponse["player"]) {
    if (!player) return;
    playerId.value = player.player_id;
    stats.score = player.score;
    stats.wins = player.wins;
    stats.matches = player.matches;
    stats.single_resonator_score = player.single_resonator_score;
    stats.single_skeleton_score = player.single_skeleton_score;
  }

  function clearSession() {
    playerId.value = "";
    token.value = "";
    loggedIn.value = false;
    stats.score = 0;
    stats.wins = 0;
    stats.matches = 0;
    stats.single_resonator_score = 0;
    stats.single_skeleton_score = 0;
    removeLocalStorage("phrolova_player_id");
    removeLocalStorage("phrolova_player_token");
    removeLocalStorage("phrolova_logged_in");
    _hydrated = false;
    // 让 refresh/socket 侧感知到清态（已由 watch 同步 clearAuthenticated，这里双保险）
    clearAuthenticated();
  }

  async function refreshPlayer() {
    if (!loggedIn.value || !playerId.value) return;
    const data = await api.me();
    applyPlayer(data.player);
  }

  let _hydrated = false;

  async function hydrate() {
    if (!loggedIn.value || !playerId.value) {
      clearSession();
      return;
    }
    // 已成功 hydrate 过则不重复调用（App.vue 初始化时已执行一次）
    if (_hydrated) return;
    try {
      await refreshPlayer();
      error.value = "";
      _hydrated = true;
    } catch (reason) {
      // 仅认证类错误（401 且 refresh 也失败）才清会话；
      // 网络/服务器等瞬态错误不清会话，避免用户被迫重新登录
      const err = reason as { response?: { status?: number }; error_code?: string };
      const isAuthError = err?.response?.status === 401 ||
        err?.error_code === 'AUTH_EXPIRED' ||
        err?.error_code === 'AUTH_REQUIRED';
      if (isAuthError) {
        clearSession();
        error.value = errMsg(reason) || "登录态已失效，请重新登录";
      } else {
        error.value = errMsg(reason) || "网络异常，稍后重试";
      }
    }
  }

  async function login(payload: api.LoginPayload) {
    loading.value = true;
    error.value = "";
    try {
      const data = await api.login(payload);
      loggedIn.value = true;
      applyPlayer(data.player);
      token.value = data.token || "";
      return data;
    } catch (reason) {
      const msg = errMsg(reason);
      error.value = msg || "登录失败";
      throw reason;
    } finally {
      loading.value = false;
    }
  }

  async function register(payload: api.RegisterPayload) {
    loading.value = true;
    error.value = "";
    try {
      const data = await api.register(payload);
      loggedIn.value = true;
      applyPlayer(data.player);
      token.value = data.token || "";
      return data;
    } catch (reason) {
      const msg = errMsg(reason);
      error.value = msg || "注册失败";
      throw reason;
    } finally {
      loading.value = false;
    }
  }

  async function upgradePassword(payload: api.UpgradePasswordPayload) {
    loading.value = true;
    error.value = "";
    try {
      const data = await api.upgradePassword(payload);
      loggedIn.value = true;
      applyPlayer(data.player);
      token.value = data.token || "";
      return data;
    } catch (reason) {
      const msg = errMsg(reason);
      error.value = msg || "密码升级失败";
      throw reason;
    } finally {
      loading.value = false;
    }
  }

  async function updatePlayerId(newId: string) {
    if (!isAuthenticated.value) {
      throw new Error("当前未登录");
    }
    loading.value = true;
    error.value = "";
    try {
      const data = await api.updatePlayerId({
        oldId: playerId.value,
        newId,
        token: token.value,
      });
      applyPlayer(data.player);
      token.value = data.token || token.value;
      return data;
    } catch (reason) {
      const msg = errMsg(reason);
      error.value = msg || "修改 ID 失败";
      throw reason;
    } finally {
      loading.value = false;
    }
  }

  function logout() {
    clearSession();
    error.value = "";
  }

  return {
    playerId,
    token,
    loggedIn,
    loading,
    error,
    stats,
    isAuthenticated,
    hydrate,
    login,
    register,
    upgradePassword,
    refreshPlayer,
    updatePlayerId,
    logout,
  };
});
