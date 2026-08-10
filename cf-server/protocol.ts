// Cloudflare Worker + Durable Objects 多人对战协议
// 定义消息类型、状态接口、工具函数
//
// 消息协议（JSON over WebSocket）：
//   Client → Server:  { type: "...", payload: {...} }
//   Server → Client:  { type: "...", payload: {...} }

export type QuizType = 'resonator' | 'skeleton' | 'global';
export type Difficulty = 'easy' | 'hard';

// ── 客户端→服务端 事件 ──
export const C2S = {
  AUTH: 'multi:auth',
  CREATE_ROOM: 'multi:create_room',
  JOIN_ROOM: 'multi:join_room',
  QUEUE_JOIN: 'multi:queue_join',
  QUEUE_CANCEL: 'multi:queue_cancel',
  SUBMIT_GUESS: 'multi:submit_guess',
  LEAVE_ROOM: 'multi:leave_room',
  RESTART_ROOM: 'multi:restart_room',
  HEARTBEAT: 'multi:heartbeat',
  RESUME_ROOM: 'multi:resume_room',
} as const;

// ── 服务端→客户端 事件 ──
export const S2C = {
  AUTHED: 'multi:authed',
  ERROR: 'multi:error',
  MATCHING: 'multi:matching',
  ROOM_CREATED: 'multi:room_created',
  ROOM_JOINED: 'multi:room_joined',
  COUNTDOWN_STARTED: 'multi:countdown_started',
  ROOM_STATE: 'multi:room_state',
  ROUND_STARTED: 'multi:round_started',
  GUESS_RESULT: 'multi:guess_result',
  ROUND_FINISHED: 'multi:round_finished',
  MATCH_FINISHED: 'multi:match_finished',
  OPPONENT_FORFEIT: 'multi:opponent_forfeit',
  ROOM_EXPIRED: 'multi:room_expired',
  KICKED: 'multi:kicked',
  PONG: 'multi:pong',
} as const;

// ── 类型 ──
export type RoomStatus = 'waiting' | 'countdown' | 'playing' | 'finished';
export type RoundStatus = 'idle' | 'active' | 'resolved';

export interface RoomPlayer {
  playerId: string;
  dbId: number | null;
  roundWins: number;
  attemptsUsed: number;
  attemptsLimit: number;
  guesses: Array<{
    revealed: boolean;
    guess: Record<string, unknown>;
    compare: Record<string, unknown>;
  }>;
}

export interface RoomState {
  roomCode: string;
  quizType: QuizType;
  difficulty: Difficulty;
  bestOf: number;
  scoreDelta: number;
  roomStatus: RoomStatus;
  roundStatus: RoundStatus;
  round: number;
  roundWinner: number | null;
  roundWins: number[];
  timeLeft: number;
  timeLimit: number;
  countdownLeft: number;
  target: Record<string, unknown> | null;
  targetVersion: number | null;
  targetCost: number | null;
  overallWinner: number | null;
  forfeitBy: string | null;
  creator: string;
  rematchVotes: string[];
  players: RoomPlayer[];
  opponentId: string;
  roundHistory: Array<{
    round: number;
    target: Record<string, unknown> | null;
    players: Array<{
      player_id: string;
      db_id: number | null;
      guesses: Array<{ revealed: boolean; guess: Record<string, unknown>; compare: Record<string, unknown> }>;
    }>;
  }>;
  // 游戏结束后已主动退出房间的玩家 ID（供前端判断对手是否已离开）
  exitedPlayers: string[];
  // 游戏中断开连接、处于重连宽限期的玩家 ID（供前端显示"对手正在重连..."提示）
  reconnectingPlayers: string[];
}

// ── 消息工具 ──
export function sendJson(ws: WebSocket, type: string, payload: unknown) {
  ws.send(JSON.stringify({ type, payload }));
}

export function parseMessage(raw: string): { type: string; payload: Record<string, unknown> } | null {
  try {
    const msg = JSON.parse(raw);
    if (typeof msg.type === 'string') return { type: msg.type, payload: msg.payload ?? {} };
    return null;
  } catch {
    return null;
  }
}

// ── 随机工具 ──
export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const buf = new Uint8Array(6);
  crypto.getRandomValues(buf);
  for (let i = 0; i < 6; i++) {
    code += chars[buf[i] % chars.length];
  }
  return code;
}

export function randomInt(max: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % max;
}