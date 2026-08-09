import type { AuthResponse, CaptchaResponse } from "@/types/game";
import { api } from "./client";

export interface LoginPayload {
  username: string;
  password: string;
  captchaId: string;
  captchaText: string;
}

export interface ScryptParams {
  salt: string;
  N: number;
  r: number;
  p: number;
  dklen: number;
}

export interface UpgradePasswordPayload {
  username: string;
  oldPasswordHash: string;
  newPassword: string;
  captchaId: string;
  captchaText: string;
}

export interface RegisterPayload {
  username: string;
  password: string;
  captchaId: string;
  captchaText: string;
}

export interface UpdatePlayerIdPayload {
  oldId: string;
  newId: string;
  /**
   * @deprecated 过渡期保留字段（PR-4 可移除）：后端已经通过请求拦截器读取 X-Player-Token，
   *   业务层不再需要手动传 token 到 body。过渡期仍双写保证老缓存客户端兼容。
   */
  token?: string;
}

export function fetchCaptcha() {
  return api.get<CaptchaResponse>("/auth/captcha") as Promise<CaptchaResponse>;
}

/**
 * 初始化玩家（老匿名开局逻辑）
 *   过渡期：player_id 仍然写 body（后端 header→body 三级回退）
 */
export function initPlayer(playerId: string) {
  return api.post<AuthResponse>("/player/init", { player_id: playerId }) as Promise<AuthResponse>;
}

export function getPlayerScore(playerId: string) {
  return api.post<AuthResponse>("/player/score", { player_id: playerId }) as Promise<AuthResponse>;
}

export function updatePlayerId(payload: UpdatePlayerIdPayload) {
  return api.post<AuthResponse>("/player/update_id", {
    old_id: payload.oldId,
    new_id: payload.newId,
    // 过渡期双写：保证即使拦截器没注入（老缓存）仍能鉴权
    token: payload.token ?? "",
  }) as Promise<AuthResponse>;
}

export function login(payload: LoginPayload) {
  return api.post<AuthResponse>("/auth/login", {
    username: payload.username,
    password: payload.password,
    captcha_id: payload.captchaId,
    captcha_text: payload.captchaText,
  }) as Promise<AuthResponse>;
}

export function register(payload: RegisterPayload) {
  return api.post<AuthResponse>("/auth/register", {
    username: payload.username,
    password: payload.password,
    captcha_id: payload.captchaId,
    captcha_text: payload.captchaText,
  }) as Promise<AuthResponse>;
}

export function logout() {
  return api.post<{ status: string; message: string }>("/auth/logout") as Promise<{ status: string; message: string }>;
}

export function fetchScryptParams(username: string) {
  return api.get<{ status: string } & ScryptParams>("/auth/scrypt-params", {
    params: { username },
  }) as Promise<{ status: string } & ScryptParams>;
}

export function upgradePassword(payload: UpgradePasswordPayload) {
  return api.post<AuthResponse>("/auth/upgrade-password", {
    username: payload.username,
    old_password_hash: payload.oldPasswordHash,
    new_password: payload.newPassword,
    captcha_id: payload.captchaId,
    captcha_text: payload.captchaText,
  }) as Promise<AuthResponse>;
}

/**
 * 【新】刷新玩家会话（与拦截器对齐；authSession.refreshAuthenticatedSession 直接 axios，
 *   此处作为业务层导出）
 */
export function refreshSession() {
  return api.post<AuthResponse>("/auth/refresh") as Promise<AuthResponse>;
}

/** 【新】拉取当前玩家信息（不轮换 secret） */
export function me() {
  return api.get<{ status: string; player: AuthResponse["player"] }>("/auth/me") as Promise<{ status: string; player: AuthResponse["player"] }>;
}
