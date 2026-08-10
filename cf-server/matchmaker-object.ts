// Matchmaker Durable Object：管理自动匹配队列
// 等待两个玩家的偏好匹配时自动创建房间

import { DurableObject } from 'cloudflare:workers';
import { RoomObject } from './room-object';
import {
  C2S, S2C, sendJson, parseMessage,
  type QuizType, type Difficulty,
  generateRoomCode,
} from './protocol';

// ── 队列条目 ──
interface QueueEntry {
  playerId: string;
  ws: WebSocket | null;
  quizType: QuizType;
  difficulty: Difficulty;
  bestOf: number;
  joinedAt: number;
  connected: boolean;
}

// ── 活跃对局记录（用于统计匹配池在线人数） ──
interface ActiveRoom {
  playerCount: number;
  createdAt: number;
}

// ── WebSocket 附件接口 ──
interface MatchmakerWsAttachment {
  playerId: string;
  token: string;
}

export class MatchmakerObject extends DurableObject {
  protected state: DurableObjectState;
  protected env: Env;
  private queue: QueueEntry[] = [];
  private connections: Map<string, WebSocket> = new Map();
  // 活跃随机匹配对局：roomCode → { playerCount, createdAt }
  private activeRooms: Map<string, ActiveRoom> = new Map();
  private matchTimer: number | null = null;
  private _tickTimer: number | null = null;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.state = state;
    this.env = env;

    // 从持久化状态恢复
    state.blockConcurrencyWhile(async () => {
      const saved = await state.storage.get('matchmaker_state');
      if (saved) {
        try {
          const data = JSON.parse(saved as string) as Record<string, unknown>;
          if (Array.isArray(data.queue)) {
            // 恢复时：所有 ws 必须置为 null（无法跨 DO 重启），connected 默认 false
            // 注意：恢复时 difficulty 和 bestOf 使用当前协议的默认值（强制 bestOf=3）
            //   避免老数据（bestOf=1/difficulty=hard 但 quizType=resonator）卡死匹配
            const now = Date.now();
            this.queue = (data.queue as Array<Omit<QueueEntry, 'ws' | 'connected'> & { connected?: boolean }>).map(e => {
              const qt = (e.quizType as QuizType) || 'resonator';
              return {
                playerId: e.playerId,
                ws: null as unknown as WebSocket,
                quizType: qt,
                difficulty: qt === 'skeleton' ? ((e.difficulty as Difficulty) || 'easy') : 'easy',
                bestOf: 3, // 随机匹配固定 BO3
                joinedAt: now, // 恢复时重置加入时间，避免立即被僵尸检测清理
                connected: false, // 恢复后必须由玩家重连时显式标记 true
              };
            });
            console.log('[MatchmakerDO] restored queue:', this.queue.map(e => `${e.playerId}(${e.quizType}/${e.difficulty}/BO${e.bestOf}) connected=${e.connected}`).join(', '));
          }
          // 恢复活跃对局记录
          if (Array.isArray(data.activeRooms)) {
            const now = Date.now();
            const MAX_ROOM_AGE = 30 * 60 * 1000;
            for (const r of data.activeRooms as Array<[string, ActiveRoom]>) {
              if (r && typeof r[0] === 'string' && r[1] && now - (r[1].createdAt || 0) < MAX_ROOM_AGE) {
                this.activeRooms.set(r[0], { playerCount: r[1].playerCount || 2, createdAt: r[1].createdAt || now });
              }
            }
            if (this.activeRooms.size > 0) {
              console.log(`[MatchmakerDO] restored activeRooms: ${this.activeRooms.size} rooms`);
            }
          }
        } catch (e) { console.warn('[MatchmakerDO] restore failed:', e); }
      }
    });

    // 兜底周期性匹配检查（3秒一次），避免因竞态/重连顺序导致匹配死锁
    this._ensureTickTimer();
  }

  private _ensureTickTimer(): void {
    if (this._tickTimer !== null) return;
    this._tickTimer = setInterval(() => {
      try {
        // 清理僵尸连接：超过 15 秒不在线的玩家从队列移除（避免持久化脏数据占坑）
        const now = Date.now();
        const beforeLen = this.queue.length;
        this.queue = this.queue.filter(e => {
          const age = now - (Number(e.joinedAt) || now);
          // 在线 OR 最近 30 秒内刚加的 → 保留
          if (e.connected || age < 30_000) return true;
          console.log(`[MatchmakerDO.tick] remove stale entry player=${e.playerId} age=${age}ms connected=${e.connected}`);
          return false;
        });
        if (this.queue.length !== beforeLen) this.persistState();

        // 清理超时活跃对局记录（超过 30 分钟视为已失效，修正 DO 驱逐导致的计数漂移）
        const MAX_ROOM_AGE = 30 * 60 * 1000;
        let roomsChanged = false;
        for (const [code, info] of this.activeRooms) {
          if (now - info.createdAt > MAX_ROOM_AGE) {
            console.log(`[MatchmakerDO.tick] remove stale active room: ${code}`);
            this.activeRooms.delete(code);
            roomsChanged = true;
          }
        }
        if (roomsChanged) this.persistState();

        if (this.queue.filter(e => e.connected).length >= 2) {
          this.tryMatch();
        }
      } catch (e) {
        console.warn('[MatchmakerDO] tick tryMatch error:', e);
      }
    }, 3000) as unknown as number;
  }

  // ── 入口：处理 WebSocket 连接 ──
  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const playerId = url.searchParams.get('playerId') || '';
      const token = url.searchParams.get('token') || '';
      const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

      if (request.headers.get('Upgrade') === 'websocket') {
        if (!playerId || !token) {
          return new Response(
            JSON.stringify({ status: 'error', message: '缺少玩家身份凭证', error_code: 'AUTH_REQUIRED' }),
            { status: 401, headers: JSON_HEADERS },
          );
        }

        // 验证 token
        const valid = await this.verifyToken(playerId, token);
        if (!valid) {
          return new Response(
            JSON.stringify({ status: 'error', message: '玩家身份校验失败或已过期，请重新登录', error_code: 'AUTH_EXPIRED' }),
            { status: 401, headers: JSON_HEADERS },
          );
        }

        // 创建 WebSocket 对
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);

        // 使用 Hibernation API 接受连接
        this.state.acceptWebSocket(server);

        // 立即建立 WebSocket 到 playerId 的映射
        this.connections.set(playerId, server);

        // 如果玩家已在队列中，标记为已连接（断线重连场景）
        const existingEntry = this.queue.find(e => e.playerId === playerId);
        if (existingEntry) {
          existingEntry.ws = server;
          existingEntry.connected = true;
          // 重连时强制归一化：bestOf=3，resonator 模式 difficulty=easy
          // 避免持久化脏数据导致 bestOf/difficulty 不匹配
          existingEntry.bestOf = 3;
          existingEntry.difficulty = existingEntry.quizType === 'skeleton' ? existingEntry.difficulty : 'easy';
          existingEntry.joinedAt = Date.now(); // 重连不视为僵尸
          sendJson(server, S2C.MATCHING, {
            message: '已重新连接，继续匹配中...',
            inQueue: true,
          });
          // 重连后立即检查是否可以匹配
          this.tryMatch();
        }

        // 发送认证消息
        sendJson(server, S2C.AUTHED, {
          playerId,
          message: '匹配服务已连接',
        });

        // 返回 WebSocket 响应
        return new Response(null, {
          status: 101,
          webSocket: client,
        });
      }

      if (request.method === 'GET') {
        const waitingPlayers = this.queue.filter(e => e.connected).length;
        const activeMatchPlayers = Array.from(this.activeRooms.values())
          .reduce((sum, r) => sum + r.playerCount, 0);
        return new Response(JSON.stringify({
          queueSize: this.queue.length,
          waitingPlayers,
          activeMatchPlayers,
          totalOnline: waitingPlayers + activeMatchPlayers,
          queue: this.queue.map(e => ({
            playerId: e.playerId,
            quizType: e.quizType,
            difficulty: e.difficulty,
            bestOf: e.bestOf,
            connected: !!e.connected,
            ageSec: Math.round((Date.now() - Number(e.joinedAt || 0)) / 1000),
          })),
        }, null, 2), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // POST /ws/matchmaker?reset=1 → 清除所有持久化状态，用于调试
      if (request.method === 'POST') {
        const url = new URL(request.url);
        if (url.searchParams.get('reset') === '1') {
          await this.state.storage.deleteAll();
          this.queue = [];
          this.activeRooms.clear();
          return new Response(JSON.stringify({ ok: true, message: 'matchmaker state cleared' }), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      return new Response('Not Found', { status: 404 });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[MatchmakerDO.fetch] error:', msg, err);
      return new Response(JSON.stringify({ error: 'Matchmaker internal error: ' + msg }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // ── Hibernation API: WebSocket 消息处理 ──
  async webSocketMessage(ws: WebSocket, message: string): Promise<void> {
    // 从 connections 映射中查找 playerId
    let playerId = '';
    for (const [pid, storedWs] of this.connections.entries()) {
      if (storedWs === ws) {
        playerId = pid;
        break;
      }
    }

    if (!playerId) return;

    const msg = parseMessage(message);
    if (!msg) return;

    // 发送认证消息（第一次消息时）
    if (msg.type === 'test') {
      sendJson(ws, S2C.AUTHED, {
        playerId,
        message: '匹配服务已连接',
      });
    }

    await this.handleMessage(playerId, msg.type, msg.payload);
  }

  // ── Hibernation API: WebSocket 关闭处理 ──
  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    // 从 connections 映射中查找 playerId
    let playerId = '';
    for (const [pid, storedWs] of this.connections.entries()) {
      if (storedWs === ws) {
        playerId = pid;
        break;
      }
    }

    if (playerId) {
      this.connections.delete(playerId);
      // 不立即移除队列，改为标记为 disconnected，允许断线重连
      const entry = this.queue.find(e => e.playerId === playerId);
      if (entry) {
        entry.connected = false;
        entry.ws = null;
        this.persistState();
      }
    }
  }

  // ── Hibernation API: WebSocket 错误处理 ──
  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    // 从 connections 映射中查找 playerId
    let playerId = '';
    for (const [pid, storedWs] of this.connections.entries()) {
      if (storedWs === ws) {
        playerId = pid;
        break;
      }
    }

    if (playerId) {
      this.connections.delete(playerId);
      const entry = this.queue.find(e => e.playerId === playerId);
      if (entry) {
        entry.connected = false;
        entry.ws = null;
        this.persistState();
      }
    }
  }

  private async handleMessage(
    playerId: string,
    type: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    switch (type) {
      case C2S.CREATE_ROOM:
        await this.handleCreateRoom(playerId, payload);
        break;
      case C2S.QUEUE_JOIN:
        await this.addToQueue(playerId, payload);
        break;
      case C2S.QUEUE_CANCEL:
        this.removeFromQueue(playerId);
        break;
      case C2S.HEARTBEAT:
        this.sendToPlayer(playerId, S2C.PONG, {});
        break;
      default:
        this.sendToPlayer(playerId, S2C.ERROR, { message: `未知消息类型: ${type}` });
    }
  }

  private async handleCreateRoom(playerId: string, payload: Record<string, unknown>): Promise<void> {
    const ws = this.connections.get(playerId);
    if (!ws) return;

    const quizType = (payload.quizType as QuizType) || 'resonator';

    // 全局模式仅限随机匹配，不允许创建房间
    if (quizType === 'global') {
      sendJson(ws, S2C.ERROR, { message: '全局模式仅限随机匹配，无法创建房间', error_code: 'GLOBAL_CREATE_NOT_ALLOWED' });
      return;
    }

    const difficulty = (payload.difficulty as Difficulty) || 'easy';
    const bestOf = Number(payload.bestOf) || 1;

    const roomCode = generateRoomCode();

    sendJson(ws, S2C.ROOM_CREATED, {
      roomCode,
      quizType,
      bestOf,
      difficulty,
    });
  }

  private async addToQueue(playerId: string, payload: Record<string, unknown>): Promise<void> {
    const ws = this.connections.get(playerId);
    if (!ws) {
      console.warn(`[MatchmakerDO.addToQueue] player ${playerId} not in connections map`);
      return;
    }

    const quizType = (payload.quizType as QuizType) || 'resonator';
    // 全局和共鸣者模式统一使用 'easy' 难度，仅声骸模式区分难度
    const difficulty: Difficulty = quizType === 'skeleton'
      ? ((payload.difficulty as Difficulty) || 'easy')
      : 'easy';
    // 按游戏规则文档：随机匹配固定 BO3 赛制，忽略前端传入值
    const bestOf = 3;
    console.log(`[MatchmakerDO.addToQueue] player=${playerId} quizType=${quizType} difficulty=${difficulty} bestOf=${bestOf}`);

    // 检查是否已在队列（断线重连场景：更新 ws 和 connected 标记）
    const existing = this.queue.find(e => e.playerId === playerId);
    if (existing) {
      existing.ws = ws;
      existing.connected = true;
      existing.quizType = quizType;
      existing.difficulty = difficulty;
      existing.bestOf = bestOf;
      existing.joinedAt = Date.now(); // 重连重置计时，避免 30 秒僵尸检测误删
      this.sendToPlayer(playerId, S2C.MATCHING, {
        message: '已重新加入匹配队列，继续等待对手...',
        inQueue: true,
      });
      console.log(`[MatchmakerDO.addToQueue] player=${playerId} re-joined (existing). queue now: ${this.queue.map(e => e.playerId).join(',')}`);
      this.tryMatch();
      this.persistState();
      return;
    }

    this.queue.push({
      playerId,
      ws,
      quizType,
      difficulty,
      bestOf,
      joinedAt: Date.now(),
      connected: true,
    });

    this.sendToPlayer(playerId, S2C.MATCHING, {
      message: '已加入匹配队列，请等待对手...',
      inQueue: true,
    });
    console.log(`[MatchmakerDO.addToQueue] player=${playerId} pushed. queue now: ${this.queue.map(e => e.playerId).join(',')}`);

    this.broadcastQueueStatus();
    this.tryMatch();
    await this.persistState();
  }

  private removeFromQueue(playerId: string): void {
    this.queue = this.queue.filter(e => e.playerId !== playerId);
    this.broadcastQueueStatus();
    this.persistState();
  }

  private broadcastQueueStatus(): void {
    for (const entry of this.queue) {
      this.sendToPlayer(entry.playerId, S2C.MATCHING, {
        message: `匹配队列中有 ${this.queue.length} 位玩家等待`,
        inQueue: true,
      });
    }
  }

  private async tryMatch(): Promise<void> {
    // 只匹配已连接的玩家
    const connected = this.queue.filter(e => e.connected && e.ws);
    console.log(`[MatchmakerDO.tryMatch] queue=${this.queue.length} connected=${connected.length} entries=[${connected.map(e => `${e.playerId}(${e.quizType}/${e.difficulty}/BO${e.bestOf})`).join(', ')}]`);
    if (connected.length < 2) return;

    // 查找前两个偏好匹配的玩家
    for (let i = 0; i < connected.length; i++) {
      for (let j = i + 1; j < connected.length; j++) {
        const a = connected[i];
        const b = connected[j];

        // 检查偏好是否匹配
        // 全局(global)可以匹配任何类型（共鸣者/声骸/全局）
        const aIsGlobal = a.quizType === 'global';
        const bIsGlobal = b.quizType === 'global';

        // 确定两位玩家是否可以匹配
        let canMatch: boolean;
        if (aIsGlobal || bIsGlobal) {
          // 全局玩家可以匹配任何人
          canMatch = true;
        } else {
          // 非全局玩家：需要 quizType 相同
          const sameQuiz = a.quizType === b.quizType;
          // 共鸣者(resonator) 模式没有难度概念，忽略 difficulty 差异避免误配
          const sameDifficulty = a.quizType === 'skeleton' ? a.difficulty === b.difficulty : true;
          canMatch = sameQuiz && sameDifficulty;
        }

        if (canMatch) {
          // 确定实际游戏类型：
          //   若一方为全局，使用对方的类型；双方都是全局则默认共鸣者
          let actualQuizType: QuizType;
          let actualDifficulty: Difficulty;

          if (aIsGlobal && !bIsGlobal) {
            actualQuizType = b.quizType;
            actualDifficulty = b.difficulty;
          } else if (bIsGlobal && !aIsGlobal) {
            actualQuizType = a.quizType;
            actualDifficulty = a.difficulty;
          } else if (aIsGlobal && bIsGlobal) {
            actualQuizType = 'resonator';
            actualDifficulty = 'easy';
          } else {
            actualQuizType = a.quizType;
            actualDifficulty = a.difficulty;
          }

          console.log(`[MatchmakerDO.tryMatch] matched! ${a.playerId} vs ${b.playerId} (game=${actualQuizType}/${actualDifficulty}/BO${a.bestOf})`);
          await this.createRoomForMatch(a, b, actualQuizType, actualDifficulty);
          return;
        }
      }
    }
    console.log('[MatchmakerDO.tryMatch] no pairs matched (check quizType/difficulty/bestOf compatibility)');
  }

  private async createRoomForMatch(a: QueueEntry, b: QueueEntry, actualQuizType: QuizType, actualDifficulty: Difficulty): Promise<void> {
    // 从队列中移除
    this.queue = this.queue.filter(e => e.playerId !== a.playerId && e.playerId !== b.playerId);

    // 通知两位玩家匹配成功
    const roomCode = generateRoomCode();
    console.log(`[MatchmakerDO.createRoomForMatch] roomCode=${roomCode} a=${a.playerId} b=${b.playerId} a.hasWs=${!!a.ws} b.hasWs=${!!b.ws} game=${actualQuizType}/${actualDifficulty}`);

    // 将两位玩家连接到同一个 Room Durable Object
    const roomId = this.env.ROOM.idFromName(roomCode);
    const _roomStub = this.env.ROOM.get(roomId);

    // 通知客户端房间信息，客户端收到后会断开并重新连接到 /ws/room/{roomCode}
    const countdownPayload = {
      roomCode,
      countdownLeft: 3,
      quizType: actualQuizType,
      bestOf: a.bestOf,
      difficulty: actualDifficulty,
    };
    if (a.ws) sendJson(a.ws, S2C.COUNTDOWN_STARTED, countdownPayload);
    else console.warn(`[MatchmakerDO.createRoomForMatch] a.player ${a.playerId} ws null, cannot send COUNTDOWN_STARTED`);
    if (b.ws) sendJson(b.ws, S2C.COUNTDOWN_STARTED, countdownPayload);
    else console.warn(`[MatchmakerDO.createRoomForMatch] b.player ${b.playerId} ws null, cannot send COUNTDOWN_STARTED`);

    // 注册活跃对局，用于匹配池在线人数统计
    this.activeRooms.set(roomCode, { playerCount: 2, createdAt: Date.now() });

    this.broadcastQueueStatus();
    this.persistState();
  }

  // ── RPC: RoomObject 销毁时通知匹配器减少活跃对局计数 ──
  async notifyMatchEnded(roomCode: string): Promise<void> {
    if (this.activeRooms.has(roomCode)) {
      this.activeRooms.delete(roomCode);
      this.persistState();
      console.log(`[MatchmakerDO.notifyMatchEnded] room=${roomCode} removed. activeRooms=${this.activeRooms.size}`);
    }
  }

  private sendToPlayer(playerId: string, type: string, payload: unknown): void {
    const ws = this.connections.get(playerId);
    if (ws) {
      try {
        sendJson(ws, type, payload);
      } catch { /* ignore */ }
    }
  }

  private async persistState(): Promise<void> {
    try {
      const data = {
        queue: this.queue.map(e => ({
          playerId: e.playerId,
          quizType: e.quizType,
          difficulty: e.difficulty,
          bestOf: e.bestOf,
          joinedAt: e.joinedAt,
        })),
        activeRooms: Array.from(this.activeRooms.entries()),
      };
      await this.state.storage.put('matchmaker_state', JSON.stringify(data));
    } catch { /* ignore */ }
  }

  // ── Token 验证 ──
  private async verifyToken(playerId: string, token: string): Promise<boolean> {
    try {
      if (!this.env?.DB) {
        // DB 绑定时缺失的降级路径：本地开发如果没有 D1 初始化，
        // 仅检查 token 非空作为快速通过（客户端已确保 token 是登录态下发）
        return token.length > 0;
      }
      const result = await this.env.DB.prepare(
        'SELECT secret FROM players WHERE player_id = ?1 LIMIT 1'
      ).bind(playerId).all();
      const row = result.results[0] as { secret: string } | undefined;
      if (!row?.secret) return false;
      return constantTimeEqual(row.secret, token);
    } catch (e: unknown) {
      console.warn('[MatchmakerDO.verifyToken] fallback due to DB error:', e);
      // DB 查询失败降级：确保 WS 升级仍能成功，避免将匹配系统完全锁死
      return token.length > 0;
    }
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}