import { computed, reactive, shallowRef, watch } from "vue";
import { defineStore } from "pinia";

import { useCookieStorage, removeCookieStorage } from "@/composables/useStorage";
import type { AuthResponse } from "@/types";
import * as api from "@/api";
import { markAuthenticated, clearAuthenticated } from "@/api/authSession";
import { errMsg } from "@/api/client";
import { i18n } from "@/i18n";

export const useAuthStore = defineStore("auth", () => {
  // 登录态持久化至 Cookie（替代 localStorage），30 天有效期，实际登录态由后端 token 校验/轮换控制
  const playerId = useCookieStorage("phrolova_player_id", "");
  const token = useCookieStorage("phrolova_player_token", "");
  const loggedIn = useCookieStorage("phrolova_logged_in", false);

  const loading = shallowRef(false);
  const error = shallowRef("");
  const dbId = shallowRef<number | null>(null);
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
    dbId.value = player.id ?? null;
    stats.score = player.score;
    stats.wins = player.wins;
    stats.matches = player.matches;
    stats.single_resonator_score = player.single_resonator_score;
    stats.single_skeleton_score = player.single_skeleton_score;
  }

  function clearSession() {
    // 防止 session-cleared 事件回调重入导致竞态（watch sync 写空值 → removeCookie → 又被事件触发）
    if (_clearing) return;
    _clearing = true;
    try {
      playerId.value = "";
      token.value = "";
      loggedIn.value = false;
      dbId.value = null;
      stats.score = 0;
      stats.wins = 0;
      stats.matches = 0;
      stats.single_resonator_score = 0;
      stats.single_skeleton_score = 0;
      // writeCookieValue 对空值/false 已自动删除 cookie，这里显式删除作双保险
      removeCookieStorage("phrolova_player_id");
      removeCookieStorage("phrolova_player_token");
      removeCookieStorage("phrolova_logged_in");
      _hydrated = false;
      // 让 refresh/socket 侧感知到清态（已由 watch 同步 clearAuthenticated，这里双保险）
      clearAuthenticated();
    } finally {
      _clearing = false;
    }
  }

  async function refreshPlayer() {
    if (!loggedIn.value || !playerId.value) return;
    const data = await api.me();
    applyPlayer(data.player);
  }

  let _hydrated = false;
  let _clearing = false;

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
      // hydrate 失败时不清 session：避免并发 refresh 竞态（多请求同时 401 触发多次 refresh 轮换 token）
      // 或瞬态故障（D1 不可用、网络抖动）导致刷新页面就掉登录。
      // 保留 cookie/ref 登录态，后续 API 请求通过拦截器自动处理 token 过期（refresh + 重放）。
      // 若 token 确实无效，用户下次主动操作时由 socket.ts 的 session-cleared 事件触发 clearSession。
      error.value = errMsg(reason) || i18n.global.t('errors.default');
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
      error.value = msg || i18n.global.t('auth.loginFailed');
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
      error.value = msg || i18n.global.t('auth.registerFailed');
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
      error.value = msg || i18n.global.t('auth.upgradeFailed');
      throw reason;
    } finally {
      loading.value = false;
    }
  }

  async function updatePlayerId(newId: string) {
    if (!isAuthenticated.value) {
      throw new Error(i18n.global.t('auth.notAuthenticated'));
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
      error.value = msg || i18n.global.t('auth.updateIdFailed');
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
    dbId,
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
