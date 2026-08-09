import type {
  Difficulty,
  QuizType,
  ResonatorNameEntry,
  ResonatorRow,
  SingleDrawResponse,
  SingleGuessResponse,
  SkeletonNameEntry,
  SkeletonRow,
} from "@/types/game";
import { api } from "./client";

export function health() {
  return api.get<{ status: string }>("/health") as Promise<{ status: string }>;
}

export function fetchResonatorNames() {
  return api.get<{ status: string; names: ResonatorNameEntry[] }>("/names") as Promise<{ status: string; names: ResonatorNameEntry[] }>;
}

export function fetchSkeletonNames() {
  return api.get<{ status: string; names: SkeletonNameEntry[] }>("/skeleton_names") as Promise<{ status: string; names: SkeletonNameEntry[] }>;
}

/**
 * 抽取目标
 *   过渡期：若有 playerId/token，仍双写 body（后端 header→body 回退）+ 拦截器也注入 header；
 *          若没有则走匿名 GET（或 POST 匿名，都兼容）
 */
export function drawTarget(
  quizType: QuizType,
  difficulty: Difficulty,
  playerId?: string,
  token?: string,
) {
  if (playerId && token) {
    // 过渡期双写：header（拦截器注入）+ body（保证老缓存客户端即使拦截器逻辑未加载也能跑）
    return api.post<SingleDrawResponse>("/draw", {
      type: quizType,
      difficulty,
      player_id: playerId,
      token,
    }) as Promise<SingleDrawResponse>;
  }
  return api.get<SingleDrawResponse>("/draw", {
    params: { type: quizType, difficulty },
  }) as Promise<SingleDrawResponse>;
}

/**
 * 提交猜测
 *   - 带 playerId/token → 走服务端 target 模式（过渡期仍双写 body）
 *   - 不带 → 匿名模式，target/type 必填
 */
export function submitGuess(
  guessName: string,
  playerId: string,
  token: string,
  target?: ResonatorRow | SkeletonRow,
  quizType?: QuizType,
) {
  const body: Record<string, unknown> = { guess: guessName };
  if (playerId && token) {
    // 双写 body + header
    body.player_id = playerId;
    body.token = token;
  } else {
    body.target = target;
    body.type = quizType;
  }
  return api.post<SingleGuessResponse>("/guess", body) as Promise<SingleGuessResponse>;
}
