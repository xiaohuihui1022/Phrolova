import type { Difficulty, QuizType } from "@/types/game";

// ── Client → Server event names ──
export const C2S = {
  AUTH: "multi:auth",
  RESUME_ROOM: "multi:resume_room",
  HEARTBEAT: "multi:heartbeat",
  CREATE_ROOM: "multi:create_room",
  JOIN_ROOM: "multi:join_room",
  QUEUE_JOIN: "multi:queue_join",
  QUEUE_CANCEL: "multi:queue_cancel",
  SUBMIT_GUESS: "multi:submit_guess",
  LEAVE_ROOM: "multi:leave_room",
  RESTART_ROOM: "multi:restart_room",
  POOL_STATS_SUBSCRIBE: "multi:pool_stats_subscribe",
  // 仅"创建房间"路径使用：玩家标记已准备 / 房主手动开始对局
  PLAYER_READY: "multi:player_ready",
  START_MATCH: "multi:start_match",
} as const;

// ── Server → Client event names ──
export const S2C = {
  AUTHED: "multi:authed",
  ERROR: "multi:error",
  MATCHING: "multi:matching",
  ROOM_CREATED: "multi:room_created",
  ROOM_JOINED: "multi:room_joined",
  COUNTDOWN_STARTED: "multi:countdown_started",
  ROOM_STATE: "multi:room_state",
  ROUND_STARTED: "multi:round_started",
  GUESS_RESULT: "multi:guess_result",
  ROUND_FINISHED: "multi:round_finished",
  MATCH_FINISHED: "multi:match_finished",
  OPPONENT_FORFEIT: "multi:opponent_forfeit",
  ROOM_EXPIRED: "multi:room_expired",
  KICKED: "multi:kicked",
  PONG: "multi:pong",
  POOL_STATS: "multi:pool_stats",
} as const;

// ── Client → Server payload types ──
export interface CreateRoomPayload {
  quizType: QuizType;
  bestOf: number;
  difficulty: Difficulty;
}

export interface JoinRoomPayload {
  roomCode: string;
}

export interface QueueJoinPayload {
  quizType: QuizType;
  difficulty: Difficulty;
}

export interface SubmitGuessPayload {
  roomCode: string;
  guessName: string;
}

export interface LeaveRoomPayload {
  roomCode: string;
}

// ── Server → Client payload types ──
export interface AuthedPayload {
  playerId: string;
  message: string;
}

export interface ErrorPayload {
  message: string;
}

export interface MatchingPayload {
  message: string;
  inQueue?: boolean;
}

export interface RoomCreatedPayload {
  roomCode: string;
  quizType: QuizType;
  bestOf: number;
  difficulty: Difficulty;
}

export interface RoomJoinedPayload {
  roomCode: string;
}

export interface CountdownStartedPayload {
  roomCode: string;
  countdownLeft: number;
  quizType: QuizType;
  difficulty: Difficulty;
  bestOf: number;
}

export interface RoundStartedPayload {
  roomCode: string;
  round: number;
  quizType: QuizType;
  difficulty: Difficulty;
  timeLimit: number;
}

export interface GuessResultPayload {
  guess: Record<string, unknown>;
  compare: Record<string, unknown>;
  attemptsUsed: number;
  attemptsLeft: number;
}

export interface RoundFinishedPayload {
  roomCode: string;
  round: number;
  roundWinner: number | null;
  roundWins: number[];
  target: Record<string, unknown> | null;
  overallWinner: number | null;
  roundResult?: "win" | "loss" | "draw";
}

export interface MatchFinishedPayload {
  roomCode: string;
  overallWinner: number;
  scoreDelta: number;
  target?: Record<string, unknown> | null;
  forfeit?: boolean;
}

export interface OpponentForfeitPayload {
  message: string;
  scoreDelta: number;
}

export type { MultiplayerRoomState } from "@/types/game";