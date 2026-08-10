// Room Durable Object：管理房间状态、游戏逻辑、WebSocket 连接
//
// 消息协议（JSON）：
//   C2S: { type: 'multi:xxx', payload: {...} }
//   S2C: { type: 'multi:xxx', payload: {...} }

import { DurableObject } from 'cloudflare:workers';
import {
  C2S, S2C, sendJson, parseMessage,
  type RoomPlayer, type RoomState,
  type QuizType, type Difficulty,
} from './protocol';
import { drawTarget, lookupGuess, buildCompare, allMatch, applyMultiScore, recordMatch } from './game';

// ── WebSocket 附件接口（用于 Hibernation API） ──
interface WsAttachment {
  playerId: string;
  token: string;
}

// ── MatchmakerObject RPC 接口（避免循环导入） ──
interface MatchmakerRpc {
  notifyMatchEnded(roomCode: string): Promise<void>;
}

// ── Room Durable Object ──
export class RoomObject extends DurableObject {
  protected env: Env;
  protected state: DurableObjectState;
  
  private roomCode: string = '';
  private quizType: QuizType = 'resonator';
  private difficulty: Difficulty = 'easy';
  private bestOf: number = 1;
  private scoreDelta: number = 0;
  private roomStatus: RoomState['roomStatus'] = 'waiting';
  private roundStatus: RoomState['roundStatus'] = 'idle';
  private round: number = 0;
  private roundWinner: number | null = null;
  private roundWins: number[] = [0, 0];
  private timeLeft: number = 0;
  private timeLimit: number = 90;
  private countdownLeft: number = 3;
  private target: Record<string, unknown> | null = null;
  private overallWinner: number | null = null;
  private forfeitBy: string | null = null;
  private creator: string = '';
  private rematchVotes: string[] = [];
  private players: RoomPlayer[] = [];
  private opponentId: string = '';
  // 随机匹配（true）才加减分；创建房间对局（false）不加减分
  private isRandomMatch: boolean = false;
  private roundHistory: RoomState['roundHistory'] = [];
  private lastActivity: number = 0;
  // 游戏结束后已主动退出房间的玩家 ID（保留 players 数组让剩余玩家仍能查看对局数据）
  private exitedPlayers: Set<string> = new Set();
  // 游戏中断开连接的玩家 ID（宽限期内允许重连，超时才判负）
  private disconnectedPlayers: Set<string> = new Set();
  private reconnectTimer: number | null = null;
  private graceDeadline: number = 0;
  private timerPaused: boolean = false;
  // 重连宽限期：30 秒，覆盖页面刷新 + 自动重连耗时
  private readonly RECONNECT_GRACE_MS: number = 30000;

  // WebSocket 管理
  private connections: Map<string, WebSocket> = new Map();
  private gameTimer: number | null = null;
  private countdownTimer: number | null = null;
  private cleanupTimer: number | null = null;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.state = state;
    this.env = env;
    this.lastActivity = Date.now();

    // 从持久化状态恢复
    state.blockConcurrencyWhile(async () => {
      const saved = await state.storage.get('room_state');
      if (saved) {
        try {
          const data = JSON.parse(saved as string) as Record<string, unknown>;
          // 恢复除 connections/players/timers 外的所有属性
          for (const key of Object.keys(data)) {
            if (key !== 'connections' && key !== 'players' && key !== 'gameTimer' && key !== 'countdownTimer' && key !== 'cleanupTimer' && key !== 'exitedPlayers' && key !== 'disconnectedPlayers' && key !== 'reconnectTimer') {
              (this as Record<string, unknown>)[key] = data[key];
            }
          }
          // exitedPlayers 特殊处理：从数组恢复为 Set
          if (Array.isArray(data.exitedPlayers)) {
            this.exitedPlayers = new Set(data.exitedPlayers as string[]);
          }
          // disconnectedPlayers 特殊处理：从数组恢复为 Set
          if (Array.isArray(data.disconnectedPlayers)) {
            this.disconnectedPlayers = new Set(data.disconnectedPlayers as string[]);
          }
        } catch { /* ignore */ }
      }

      // 恢复后：处理重连宽限期（DO 冬眠唤醒场景）
      if (this.roomStatus === 'playing' && this.disconnectedPlayers.size > 0) {
        const remaining = this.graceDeadline - Date.now();
        if (remaining <= 0) {
          // 宽限期在冬眠期间已过期：直接结算
          if (this.disconnectedPlayers.size >= this.players.length) {
            this.disconnectedPlayers.clear();
          } else {
            this.forfeitBy = this.disconnectedPlayers.values().next().value || null;
            this.disconnectedPlayers.clear();
          }
          this.timerPaused = false;
          await this.endMatch();
        } else {
          // 用剩余时间重启宽限计时器，游戏计时保持暂停
          this.timerPaused = true;
          this.reconnectTimer = setTimeout(() => {
            this.handleGraceExpired();
          }, remaining) as unknown as number;
        }
      }
    });

    // 设置空闲清理定时器（5分钟无活动自动销毁）
    this.scheduleCleanup();
  }

  // ── 入口：接收 Worker 转发的 WebSocket ──
  async fetch(request: Request): Promise<Response> {
    try {
      // 从 URL 查询参数获取认证信息
      const url = new URL(request.url);
      const playerId = url.searchParams.get('playerId') || '';
      const token = url.searchParams.get('token') || '';
      const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
      
      // 从 URL 路径提取房间号（格式：/ws/room/{roomCode}）
      let roomCode = '';
      const pathname = url.pathname;
      const roomPrefix = '/ws/room/';
      if (pathname.startsWith(roomPrefix)) {
        roomCode = pathname.slice(roomPrefix.length);
      }

      // 处理 WebSocket 升级
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

        // 设置房间号（如果尚未设置）
        if (!this.roomCode && roomCode) {
          this.roomCode = roomCode;
        }

        // 新玩家加入房间
        await this.handleConnection(server, playerId);

        // 返回 WebSocket 响应
        return new Response(null, {
          status: 101,
          webSocket: client,
        });
      }

      // HTTP 请求（用于状态查询）
      if (request.method === 'GET') {
        return this.handleHttpGet();
      }

      return new Response('Not Found', { status: 404 });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[RoomDO.fetch] error:', msg, err);
      return new Response(JSON.stringify({ error: 'Room internal error: ' + msg }), {
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
      this.handleDisconnect(playerId);
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
    }
  }

  // ── WebSocket 连接处理（新玩家加入 / 玩家重连） ──
  private async handleConnection(ws: WebSocket, playerId: string): Promise<void> {
    this.lastActivity = Date.now();
    this.scheduleCleanup();

    // 发送认证成功消息
    sendJson(ws, S2C.AUTHED, {
      playerId,
      message: 'WebSocket 连接已建立',
    });

    // 如果是新玩家，自动加入房间
    const existingPlayer = this.players.find(p => p.playerId === playerId);
    if (!existingPlayer) {
      if (this.players.length < 2) {
        await this.addPlayer(playerId);
      } else {
        // 房间已满
        sendJson(ws, S2C.ERROR, { message: '房间已满' });
        ws.close(1013, 'Room full');
        return;
      }
    }

    // 重连宽限期内的玩家重新连接：立即取消弃权计时 + 恢复游戏计时
    // （必须在 WebSocket 建立时处理，不能等 RESUME_ROOM 消息，否则宽限期可能先超时）
    if (this.disconnectedPlayers.has(playerId)) {
      this.disconnectedPlayers.delete(playerId);
      if (this.disconnectedPlayers.size === 0) {
        this.cancelReconnectGrace();
        this.resumeGameTimer();
      }
      // 通知对手：玩家已重连（fire-and-forget，不阻塞 101 响应）
      this.broadcastState();
      this.persistState();
      return;
    }

    // 注意：新玩家加入时不在此处 broadcastState / persistState
    // 房间状态广播和持久化由 CREATE_ROOM / JOIN_ROOM / RESUME_ROOM 等消息处理器负责
    // 这样可以避免发送配置不正确的冗余 ROOM_STATE，也避免 DO storage 写入阻塞 101 响应
  }

  // ── 断开处理 ──
  private handleDisconnect(playerId: string): void {
    this.lastActivity = Date.now();
    const wasPlayer = this.players.find(p => p.playerId === playerId);

    if (wasPlayer) {
      // 如果游戏已结束，把断开视为退出房间（让剩余玩家能继续查看数据）
      if (this.roomStatus === 'finished') {
        this.exitedPlayers.add(playerId);
        // 如果两个玩家都已退出/断开，销毁房间
        if (this.players.every(p => this.exitedPlayers.has(p.playerId))) {
          this.destroyRoom();
          return;
        }
        // 通知仍在房间的玩家：对手已离开
        this.broadcastState();
        this.persistState();
        return;
      }

      // 游戏中断开连接：启动重连宽限期，而非立即判负
      // 玩家可能只是刷新页面或网络抖动，给 30 秒重连窗口
      if (this.roomStatus === 'playing' && this.players.length === 2) {
        this.disconnectedPlayers.add(playerId);
        this.pauseGameTimer();
        this.startReconnectGrace();
        this.broadcastState();
        this.persistState();
        return;
      }
    }

    // waiting/countdown 阶段断开：直接移除玩家
    this.players = this.players.filter(p => p.playerId !== playerId);
    if (this.creator === playerId) {
      this.creator = this.players[0]?.playerId || '';
    }
    this.broadcastState();
    this.persistState();
  }

  // ── 消息路由 ──
  private async handleMessage(
    playerId: string,
    type: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    this.lastActivity = Date.now();
    this.scheduleCleanup();

    switch (type) {
      case C2S.CREATE_ROOM:
        await this.handleCreateRoom(playerId, payload);
        break;
      case C2S.JOIN_ROOM:
        await this.handleJoinRoom(playerId, payload);
        break;
      case C2S.QUEUE_JOIN:
        await this.handleQueueJoin(playerId, payload);
        break;
      case C2S.SUBMIT_GUESS:
        await this.handleSubmitGuess(playerId, payload);
        break;
      case C2S.LEAVE_ROOM:
        await this.handleLeaveRoom(playerId);
        break;
      case C2S.RESTART_ROOM:
        await this.handleRestartRoom(playerId);
        break;
      case C2S.HEARTBEAT:
        this.lastActivity = Date.now();
        this.sendToPlayer(playerId, S2C.PONG, {});
        break;
      case C2S.RESUME_ROOM:
        await this.handleResumeRoom(playerId);
        break;
      default:
        this.sendToPlayer(playerId, S2C.ERROR, { message: `未知消息类型: ${type}` });
    }
  }

  // ── 创建房间 ──
  private async handleCreateRoom(playerId: string, payload: Record<string, unknown>): Promise<void> {
    // 创建房间路径：不加减分
    this.isRandomMatch = false;
    // 允许 handleConnection 已自动添加的情况
    const existing = this.players.find(p => p.playerId === playerId);
    if (existing) {
      // 玩家已在房间中（由 handleConnection 添加），仅设置房间配置
      this.quizType = (payload.quizType as QuizType) || 'resonator';
      this.difficulty = (payload.difficulty as Difficulty) || 'easy';
      this.bestOf = Number(payload.bestOf) || 1;
      this.creator = playerId;
      this.roomStatus = 'waiting';
      // 同步已有玩家的 attemptsLimit（handleConnection 先添加时 quizType 还是默认 resonator）
      const limit = this.quizType === 'resonator' ? 4 : 8;
      for (const p of this.players) p.attemptsLimit = limit;

      this.sendToPlayer(playerId, S2C.ROOM_CREATED, {
        roomCode: this.roomCode,
        quizType: this.quizType,
        bestOf: this.bestOf,
        difficulty: this.difficulty,
      });
      this.broadcastState();
      this.persistState(); // fire-and-forget：不阻塞消息发送
      return;
    }

    if (this.roomStatus !== 'waiting' || this.players.length >= 2) {
      this.sendToPlayer(playerId, S2C.ERROR, { message: '房间已创建或已满' });
      return;
    }

    this.quizType = (payload.quizType as QuizType) || 'resonator';
    this.difficulty = (payload.difficulty as Difficulty) || 'easy';
    this.bestOf = Number(payload.bestOf) || 1;
    this.creator = playerId;

    await this.addPlayer(playerId);
    this.roomStatus = 'waiting';

    this.sendToPlayer(playerId, S2C.ROOM_CREATED, {
      roomCode: this.roomCode,
      quizType: this.quizType,
      bestOf: this.bestOf,
      difficulty: this.difficulty,
    });

    this.broadcastState();
    this.persistState(); // fire-and-forget
  }

  // ── 加入房间 ──
  private async handleJoinRoom(playerId: string, payload: Record<string, unknown>): Promise<void> {
    if (this.roomStatus !== 'waiting') {
      this.sendToPlayer(playerId, S2C.ERROR, { message: '游戏已开始，无法加入' });
      return;
    }

    // 如果是第一个加入的玩家（随机匹配路径），使用 payload 初始化房间配置
    // 注意：只有当 quizType 未设置（默认 resonator + 默认 bestOf=1）时才从 payload 读取
    // 避免后加入的玩家覆盖房主已设置的配置（createRoom 路径）
    const needInit = this.players.length === 0 ||
      (this.quizType === 'resonator' && this.bestOf === 1 && this.difficulty === 'easy' && this.creator === '');
    if (needInit) {
      // 随机匹配路径：首位玩家通过 JOIN_ROOM 加入（MatchmakerDO 路由），才加减分
      this.isRandomMatch = true;
      this.quizType = (payload.quizType as QuizType) || this.quizType;
      this.difficulty = (payload.difficulty as Difficulty) || this.difficulty;
      const bo = Number(payload.bestOf);
      if (bo === 1 || bo === 3 || bo === 5) this.bestOf = bo;
      this.creator = this.creator || playerId;
      // 同步已有玩家的 attemptsLimit（handleConnection 先添加时 quizType 还是默认 resonator）
      const limit = this.quizType === 'resonator' ? 4 : 8;
      for (const p of this.players) p.attemptsLimit = limit;
    }

    // 检查是否已被 handleConnection 自动添加
    const existing = this.players.find(p => p.playerId === playerId);
    if (!existing) {
      if (this.players.length >= 2) {
        this.sendToPlayer(playerId, S2C.ERROR, { message: '房间已满' });
        return;
      }
      await this.addPlayer(playerId);
    }

    // 通知所有玩家房间已加入
    this.broadcast(S2C.ROOM_JOINED, { roomCode: this.roomCode });
    this.broadcastState();

    // 仅当 2 名玩家都在房间时才开始倒计时
    if (this.players.length === 2) {
      this.opponentId = this.players.find(p => p.playerId !== playerId)?.playerId || '';
      // 延迟开始倒计时：给加入的玩家足够时间完成路由跳转和组件挂载
      // 避免玩家刚进入房间页面时倒计时已过半甚至游戏已开始
      this.scheduleCountdownStart(2000);
    }
    this.persistState(); // fire-and-forget
  }

  // ── 匹配队列加入 ──
  private async handleQueueJoin(playerId: string, payload: Record<string, unknown>): Promise<void> {
    if (this.players.length >= 2) {
      this.sendToPlayer(playerId, S2C.ERROR, { message: '房间已满' });
      return;
    }

    this.quizType = (payload.quizType as QuizType) || 'resonator';
    this.difficulty = (payload.difficulty as Difficulty) || 'easy';
    this.bestOf = Number(payload.bestOf) || 1;

    await this.addPlayer(playerId);
    this.creator = this.creator || playerId;

    this.sendToPlayer(playerId, S2C.MATCHING, {
      message: '已加入匹配队列，请等待对手...',
      inQueue: true,
    });

    // 广播匹配状态
    this.broadcast(S2C.MATCHING, {
      message: '等待对手加入...',
      inQueue: true,
    });

    await this.persistState();
  }

  /**
   * 延迟开始倒计时。
   * 第二名玩家加入后，先保持 waiting 状态一段准备时间，
   * 让加入的玩家有时间完成前端路由跳转和组件挂载，
   * 然后再开始正式倒计时，确保双方都能完整看到倒计时。
   */
  private scheduleCountdownStart(prepareMs: number): void {
    if (this.countdownTimer !== null) {
      clearTimeout(this.countdownTimer);
      this.countdownTimer = null;
    }
    this.countdownTimer = setTimeout(() => {
      this.countdownTimer = null;
      // 再次检查：仍处于 waiting 且仍有2名玩家（防止准备期间有人断开）
      if (this.roomStatus === 'waiting' && this.players.length === 2) {
        this.startCountdown();
      }
    }, prepareMs) as unknown as number;
  }

  // ── 倒计时 ──
  private startCountdown(): void {
    // 清理旧定时器（防止 join/create 重复触发）
    if (this.countdownTimer !== null) {
      clearTimeout(this.countdownTimer);
      this.countdownTimer = null;
    }

    this.countdownLeft = 3;
    this.roomStatus = 'countdown';

    const countdownStep = () => {
      // 每次 tick 同时广播 专用倒计时消息 + 通用状态
      this.broadcast(S2C.COUNTDOWN_STARTED, {
        roomCode: this.roomCode,
        countdownLeft: this.countdownLeft,
        quizType: this.quizType,
        difficulty: this.difficulty,
        bestOf: this.bestOf,
      });
      this.broadcastState();

      if (this.countdownLeft <= 0) {
        this.countdownTimer = null;
        this.startGame();
        return;
      }

      this.countdownLeft--;
      this.countdownTimer = setTimeout(countdownStep, 1000) as unknown as number;
    };

    countdownStep();
  }

  // ── 开始游戏 ──
  private async startGame(): Promise<void> {
    this.roomStatus = 'playing';
    this.round = 1;
    this.roundWinner = null;
    this.roundWins = [0, 0];
    this.overallWinner = null;
    
    await this.startRound();
  }

  // ── 开始一轮 ──
  private async startRound(): Promise<void> {
    this.roundStatus = 'active';
    this.roundWinner = null;
    this.timeLimit = this.quizType === 'resonator' ? 90 : 150;
    this.timeLeft = this.timeLimit;

    // 抽取目标
    this.target = await drawTarget(this.env.DB, this.quizType, this.difficulty);

    // 重置每个玩家的猜测
    const limit = this.quizType === 'resonator' ? 4 : 8;
    for (const player of this.players) {
      player.attemptsUsed = 0;
      player.attemptsLimit = limit;
      player.guesses = [];
    }

    this.broadcast(S2C.ROUND_STARTED, {
      roomCode: this.roomCode,
      round: this.round,
      quizType: this.quizType,
      difficulty: this.difficulty,
      timeLimit: this.timeLimit,
    });

    this.broadcastState();
    await this.persistState();

    // 启动计时器：每秒 tick 并广播剩余时间
    // 若有玩家处于断开重连宽限期，则暂停计时（timerPaused=true），等重连后 resumeGameTimer 恢复
    if (this.disconnectedPlayers.size === 0) {
      this.timerPaused = false;
      this.gameTimer = setInterval(() => {
        this.timeLeft--;
        this.broadcastState();
        if (this.timeLeft <= 0) {
          this.clearGameTimer();
          this.resolveRound(null);
        }
      }, 1000) as unknown as number;
    } else {
      this.timerPaused = true;
    }
  }

  // ── 提交猜测 ──
  private async handleSubmitGuess(playerId: string, payload: Record<string, unknown>): Promise<void> {
    if (this.roomStatus !== 'playing' || this.roundStatus !== 'active') {
      this.sendToPlayer(playerId, S2C.ERROR, { message: '当前不在游戏中' });
      return;
    }

    const player = this.players.find(p => p.playerId === playerId);
    if (!player) {
      this.sendToPlayer(playerId, S2C.ERROR, { message: '未在房间中' });
      return;
    }

    const guessName = (payload.guessName as string) || '';
    if (!guessName) {
      this.sendToPlayer(playerId, S2C.ERROR, { message: '缺少猜测名称' });
      return;
    }

    const limit = this.quizType === 'resonator' ? 4 : 8;
    if (player.attemptsUsed >= limit) {
      this.sendToPlayer(playerId, S2C.ERROR, { message: '猜测次数已用完' });
      return;
    }

    // 查找猜测对应的目标
    const guessRow = await lookupGuess(this.env.DB, this.quizType, guessName);
    if (!guessRow) {
      this.sendToPlayer(playerId, S2C.ERROR, { message: `找不到「${guessName}」` });
      return;
    }

    // 对比
    const compare = buildCompare(this.target!, guessRow, this.quizType);
    const isMatch = allMatch(compare as Record<string, unknown>);
    player.attemptsUsed++;
    player.guesses.push({
      revealed: isMatch,
      guess: guessRow,
      compare,
    });

    // 发送猜测结果给当前玩家
    this.sendToPlayer(playerId, S2C.GUESS_RESULT, {
      guess: guessRow,
      compare,
      attemptsUsed: player.attemptsUsed,
      attemptsLeft: limit - player.attemptsUsed,
    });

    // 如果完全匹配，当前玩家获胜
    if (isMatch) {
      this.resolveRound(this.players.indexOf(player));
      return;
    }

    // 如果所有玩家都用完了，结算
    const allDone = this.players.every(p => p.attemptsUsed >= limit);
    if (allDone) {
      this.resolveRound(null);
      return;
    }

    this.broadcastState();
    await this.persistState();
  }

  // ── 结算一轮 ──
  private async resolveRound(winnerIndex: number | null): Promise<void> {
    if (this.gameTimer !== null) {
      this.clearGameTimer();
    }

    this.roundStatus = 'resolved';
    this.roundWinner = winnerIndex;

    // 记录历史（把所有猜测标记为已展示，避免回放时仍被打码遮罩）
    this.roundHistory.push({
      round: this.round,
      target: this.target,
      players: this.players.map(p => ({
        player_id: p.playerId,
        db_id: p.dbId,
        guesses: p.guesses.map(g => ({ ...g, revealed: true })),
      })),
    });

    if (winnerIndex !== null) {
      this.roundWins[winnerIndex]++;
    }

    // 同步 class-level roundWins 到每个玩家对象（buildState 从 p.roundWins 读取）
    for (let i = 0; i < this.players.length; i++) {
      this.players[i].roundWins = this.roundWins[i] ?? 0;
    }

    // 判断整场胜负
    const winsNeeded = Math.ceil(this.bestOf / 2);
    if (this.roundWins[0] >= winsNeeded || this.roundWins[1] >= winsNeeded) {
      this.overallWinner = this.roundWins[0] > this.roundWins[1] ? 0 : 1;
      this.endMatch();
      return;
    }

    // 继续下一轮（roundResult 为 players[0] 视角的单局结果：win/loss/draw）
    let roundResult: 'win' | 'loss' | 'draw' = 'draw';
    if (winnerIndex === 0) roundResult = 'win';
    else if (winnerIndex === 1) roundResult = 'loss';
    this.broadcast(S2C.ROUND_FINISHED, {
      roomCode: this.roomCode,
      round: this.round,
      roundWinner: winnerIndex,
      roundWins: [...this.roundWins],
      roundResult,
      target: this.target,
      overallWinner: null,
    });

    this.broadcastState();
    await this.persistState();

    // 3 秒后开始下一轮
    setTimeout(async () => {
      if (this.roomStatus === 'playing') {
        this.round++;
        await this.startRound();
      }
    }, 3000);
  }

  // ── 结束比赛 ──
  private async endMatch(): Promise<void> {
    if (this.gameTimer !== null) {
      this.clearGameTimer();
    }
    // 清理重连宽限期状态
    this.cancelReconnectGrace();
    this.disconnectedPlayers.clear();
    this.timerPaused = false;

    // 同步 class-level roundWins 到每个玩家对象（防止弃权路径绕过 resolveRound 的同步）
    for (let i = 0; i < this.players.length; i++) {
      this.players[i].roundWins = this.roundWins[i] ?? 0;
    }

    // 处理对手弃权（整体胜负未设置）
    if (this.overallWinner === null && this.forfeitBy) {
      const winnerIndex = this.players.findIndex(p => p.playerId !== this.forfeitBy);
      if (winnerIndex >= 0) {
        this.overallWinner = winnerIndex;
      }
    }

    // 如果比赛过程中还有未写入 roundHistory 的当前轮次，补写入（例如对手中途弃权）
    const hasCurrentRound = this.roundHistory.some(r => r.round === this.round);
    if (!hasCurrentRound && this.round > 0 && this.target !== null) {
      this.roundHistory.push({
        round: this.round,
        target: this.target,
        players: this.players.map(p => ({
          player_id: p.playerId,
          db_id: p.dbId,
          guesses: p.guesses.map(g => ({ ...g, revealed: true })),
        })),
      });
    }

    this.roomStatus = 'finished';

    const localScoreDelta = 0;
    let forfeit = false;

    if (this.overallWinner !== null && this.isRandomMatch) {
      const winner = this.players[this.overallWinner];
      const loser = this.players[this.overallWinner === 0 ? 1 : 0];

      // 按游戏规则文档积分表计算：
      //   共鸣者:        BO1 10, BO3 30, BO5 50
      //   声骸·简单:     BO1 5,  BO3 10, BO5 15
      //   声骸·困难:     BO1 30, BO3 50, BO5 70
      let delta = 0;
      if (this.quizType === 'resonator') {
        if (this.bestOf === 1) delta = 10;
        else if (this.bestOf === 3) delta = 30;
        else if (this.bestOf === 5) delta = 50;
      } else {
        if (this.difficulty === 'easy') {
          if (this.bestOf === 1) delta = 5;
          else if (this.bestOf === 3) delta = 10;
          else if (this.bestOf === 5) delta = 15;
        } else {
          if (this.bestOf === 1) delta = 30;
          else if (this.bestOf === 3) delta = 50;
          else if (this.bestOf === 5) delta = 70;
        }
      }

      if (this.forfeitBy) {
        forfeit = true;
        const winnerId = winner?.playerId || '';
        const loserId = loser?.playerId || this.forfeitBy;
        if (winnerId && loserId && winnerId !== loserId) {
          await this.updateMatchScore(winnerId, loserId, delta);
        }
      } else {
        const winnerId = winner?.playerId || '';
        const loserId = loser?.playerId || '';
        if (winnerId && loserId) {
          await this.updateMatchScore(winnerId, loserId, delta);
        }
      }
    }

    // MATCH_FINISHED 统一按“当前玩家（players[0]）视角”的积分差值发送
    // 前端再根据我是否为 players[0] 决定取反
    const meWon = this.overallWinner === 0;
    let myDelta = localScoreDelta;
    if (this.overallWinner !== null && this.isRandomMatch) {
      const scoreTable = this.quizType === 'resonator'
        ? [10, 30, 50]
        : this.difficulty === 'easy' ? [5, 10, 15] : [30, 50, 70];
      const bestOfIdx = this.bestOf === 1 ? 0 : this.bestOf === 3 ? 1 : 2;
      const rawDelta = scoreTable[bestOfIdx] ?? 0;
      myDelta = meWon ? rawDelta : -rawDelta;
    }
    this.scoreDelta = myDelta; // 同步写入成员，供 buildState（broadcastState）使用

    this.broadcast(S2C.MATCH_FINISHED, {
      roomCode: this.roomCode,
      overallWinner: this.overallWinner,
      scoreDelta: this.scoreDelta,
      forfeitPlayerId: this.forfeitBy,
      target: this.target,
      forfeit,
    });

    this.broadcastState();
    await this.persistState();
  }

  // ── 玩家离开 ──
  private async handleLeaveRoom(playerId: string): Promise<void> {
    if (this.roomStatus === 'playing') {
      // 游戏中离开 = 弃权
      this.forfeitBy = playerId;
      this.endMatch();
    } else if (this.roomStatus === 'finished') {
      // 游戏结束后离开：记录退出玩家，保留房间数据给仍在房间的人查看
      this.exitedPlayers.add(playerId);
      this.connections.delete(playerId);

      // 如果两个玩家都已退出，立刻销毁房间
      if (this.players.every(p => this.exitedPlayers.has(p.playerId))) {
        this.destroyRoom();
        return;
      }

      // 只通过 ROOM_STATE 同步 exitedPlayers 状态，不触发 ROOM_EXPIRED（否则剩余玩家的前端会清空 roomState）
      this.broadcastState();
      await this.persistState();
    } else {
      // waiting/countdown 阶段离开：直接清理
      this.broadcast(S2C.ROOM_EXPIRED, { message: '对手已离开' });
      this.players = this.players.filter(p => p.playerId !== playerId);
      this.connections.delete(playerId);
      this.broadcastState();
      await this.persistState();
    }
  }

  // ── 销毁房间（当所有玩家都退出时调用） ──
  private destroyRoom(): void {
    // 通知 MatchmakerObject 减少活跃对局计数（仅随机匹配房间）
    // fire-and-forget：不阻塞房间销毁流程
    if (this.isRandomMatch && this.roomCode) {
      try {
        const stub = this.env.MATCHMAKER.get(this.env.MATCHMAKER.idFromName('default')) as unknown as MatchmakerRpc;
        stub.notifyMatchEnded(this.roomCode).catch(() => {});
      } catch { /* ignore */ }
    }

    this.broadcast(S2C.ROOM_EXPIRED, { message: '房间已关闭' });
    // 关闭所有 WebSocket 连接
    for (const ws of this.connections.values()) {
      try { ws.close(1000, 'Room destroyed'); } catch { /* ignore */ }
    }
    this.connections.clear();
    this.players = [];
    this.exitedPlayers.clear();
    this.disconnectedPlayers.clear();
    this.cancelReconnectGrace();
    this.timerPaused = false;
    // 删除持久化状态
    this.state.storage.delete('room_state').catch(() => {});
    // 清理定时器
    if (this.cleanupTimer !== null) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  // ── 重新开始 ──
  private async handleRestartRoom(playerId: string): Promise<void> {
    if (this.roomStatus !== 'finished') {
      this.sendToPlayer(playerId, S2C.ERROR, { message: '比赛尚未结束' });
      return;
    }

    this.rematchVotes.push(playerId);
    
    // 需要双方都同意
    const allAgreed = this.players.every(p => this.rematchVotes.includes(p.playerId));
    if (allAgreed && this.players.length >= 2) {
      this.round = 0;
      this.roundWinner = null;
      this.roundWins = [0, 0];
      this.overallWinner = null;
      this.forfeitBy = null;
      this.rematchVotes = [];
      this.roundHistory = [];
      this.exitedPlayers.clear();
      this.disconnectedPlayers.clear();
      this.cancelReconnectGrace();
      this.timerPaused = false;
      this.roomStatus = 'waiting';
      this.roundStatus = 'idle';
      this.target = null;

      const limit = this.quizType === 'resonator' ? 4 : 8;
      for (const player of this.players) {
        player.attemptsUsed = 0;
        player.attemptsLimit = limit;
        player.guesses = [];
        player.roundWins = 0;
      }

      // 双方准备就绪，开始倒计时
      this.startCountdown();
    } else {
      this.broadcast(S2C.MATCHING, {
        message: `等待另一位玩家同意重新开始 (${this.rematchVotes.length}/${this.players.length})`,
        inQueue: true,
      });
    }

    await this.persistState();
  }

  // ── 恢复房间 ──
  private async handleResumeRoom(playerId: string): Promise<void> {
    const player = this.players.find(p => p.playerId === playerId);
    if (player) {
      this.broadcastState();
    } else {
      this.sendToPlayer(playerId, S2C.ERROR, { message: '未找到房间会话' });
    }
  }

  // ── 辅助方法 ──

  private async addPlayer(playerId: string): Promise<void> {
    const existing = this.players.find(p => p.playerId === playerId);
    if (existing) return;

    // 查询数据库获取玩家数字 ID（用于前端展示）
    let dbId: number | null = null;
    try {
      if (this.env?.DB) {
        const row = await this.env.DB.prepare(
          'SELECT id FROM players WHERE player_id = ?1 LIMIT 1'
        ).bind(playerId).first();
        if (row && typeof row.id === 'number') {
          dbId = row.id;
        }
      }
    } catch { /* ignore */ }

    this.players.push({
      playerId,
      dbId,
      roundWins: 0,
      attemptsUsed: 0,
      attemptsLimit: this.quizType === 'resonator' ? 4 : 8,
      guesses: [],
    });
  }

  private async updateMatchScore(winnerId: string, loserId: string, delta: number): Promise<void> {
    try {
      await applyMultiScore(this.env.DB, winnerId, loserId, delta);
    } catch { /* ignore */ }
  }

  private async verifyToken(playerId: string, token: string): Promise<boolean> {
    try {
      if (!this.env?.DB) {
        return token.length > 0;
      }
      const result = await this.env.DB.prepare(
        'SELECT secret FROM players WHERE player_id = ?1 LIMIT 1'
      ).bind(playerId).all();
      const row = result.results[0] as { secret: string } | undefined;
      if (!row?.secret) return false;
      return constantTimeEqual(row.secret, token);
    } catch (e: unknown) {
      console.warn('[RoomDO.verifyToken] fallback due to DB error:', e);
      return token.length > 0;
    }
  }

  private buildState(): RoomState {
    // 当轮次已结算或比赛结束时，所有玩家的猜测全部标记为已揭晓
    // 防止平局（无玩家猜中）下 p.guesses[x].revealed 都是 false，导致前端遮罩打码
    const shouldRevealAll = this.roundStatus === 'resolved' || this.roomStatus === 'finished';
    // 只有揭晓阶段（resolved/finished）才把正确答案（target）下发给前端
    // 否则 playing/active/waiting/countdown 阶段 target 置 null，
    // 避免"下一回合先显示正确答案再消失"的泄漏竞态
    const safeTarget = shouldRevealAll ? this.target : null;
    // 注意：targetVersion / targetCost 仅用于 ↑↓ 方向提示，不包含答案信息，
    // 因此游戏进行中也需要下发，否则前端箭头无法显示
    const targetVersion = this.target && "version" in this.target ? Number(this.target.version) : null;
    const targetCost = this.target && "cost" in this.target ? Number(this.target.cost) : null;
    return {
      roomCode: this.roomCode,
      quizType: this.quizType,
      difficulty: this.difficulty,
      bestOf: this.bestOf,
      scoreDelta: this.scoreDelta,
      roomStatus: this.roomStatus,
      roundStatus: this.roundStatus,
      round: this.round,
      roundWinner: this.roundWinner,
      roundWins: [...this.roundWins],
      timeLeft: this.timeLeft,
      timeLimit: this.timeLimit,
      countdownLeft: this.countdownLeft,
      target: safeTarget,
      targetVersion,
      targetCost,
      overallWinner: this.overallWinner,
      forfeitBy: this.forfeitBy,
      creator: this.creator,
      rematchVotes: [...this.rematchVotes],
      players: this.players.map(p => ({
        playerId: p.playerId,
        dbId: p.dbId,
        roundWins: p.roundWins,
        attemptsUsed: p.attemptsUsed,
        attemptsLimit: p.attemptsLimit,
        guesses: shouldRevealAll
          ? p.guesses.map(g => ({ ...g, revealed: true }))
          : p.guesses,
      })),
      opponentId: this.opponentId,
      roundHistory: this.roundHistory.map(r => ({
        ...r,
        players: r.players.map(p => ({
          ...p,
          db_id: p.db_id ?? this.players.find(pl => pl.playerId === p.player_id)?.dbId ?? null,
        })),
      })),
      exitedPlayers: Array.from(this.exitedPlayers),
      reconnectingPlayers: Array.from(this.disconnectedPlayers),
    };
  }

  private broadcastState(): void {
    const state = this.buildState();
    // 为每个玩家单独发送一份定制化 state（opponentId 必须是对方的 ID，不能共享全局值）
    for (const [recipientId, ws] of this.connections.entries()) {
      const playerOpponentId = this.players.find(p => p.playerId !== recipientId)?.playerId || '';
      try {
        sendJson(ws, S2C.ROOM_STATE, { ...state, opponentId: playerOpponentId });
      } catch { /* ignore */ }
    }
  }

  private broadcast(type: string, payload: unknown): void {
    for (const ws of this.connections.values()) {
      try {
        sendJson(ws, type, payload);
      } catch { /* ignore */ }
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

  private clearGameTimer(): void {
    if (this.gameTimer !== null) {
      clearInterval(this.gameTimer);
      this.gameTimer = null;
    }
  }

  // ── 重连宽限期：游戏计时暂停/恢复 + 弃权宽限计时 ──

  private pauseGameTimer(): void {
    if (this.gameTimer !== null) {
      this.clearGameTimer();
      this.timerPaused = true;
    }
  }

  private resumeGameTimer(): void {
    this.timerPaused = false;
    if (this.roomStatus !== 'playing' || this.roundStatus !== 'active') return;
    if (this.gameTimer !== null) return; // 已在运行
    this.gameTimer = setInterval(() => {
      this.timeLeft--;
      this.broadcastState();
      if (this.timeLeft <= 0) {
        this.clearGameTimer();
        this.resolveRound(null);
      }
    }, 1000) as unknown as number;
  }

  private startReconnectGrace(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
    }
    this.graceDeadline = Date.now() + this.RECONNECT_GRACE_MS;
    this.reconnectTimer = setTimeout(() => {
      this.handleGraceExpired();
    }, this.RECONNECT_GRACE_MS) as unknown as number;
  }

  private cancelReconnectGrace(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.graceDeadline = 0;
  }

  private handleGraceExpired(): void {
    this.reconnectTimer = null;
    if (this.roomStatus !== 'playing') return;
    if (this.disconnectedPlayers.size === 0) return;

    if (this.disconnectedPlayers.size >= this.players.length) {
      // 所有玩家都断开且未重连：平局，不设胜负
      this.disconnectedPlayers.clear();
      this.timerPaused = false;
      this.endMatch();
    } else {
      // 仍有玩家在线：断开的玩家弃权
      this.forfeitBy = this.disconnectedPlayers.values().next().value || null;
      this.disconnectedPlayers.clear();
      this.timerPaused = false;
      this.endMatch();
    }
  }

  private async persistState(): Promise<void> {
    try {
      const data = {
        roomCode: this.roomCode,
        quizType: this.quizType,
        difficulty: this.difficulty,
        bestOf: this.bestOf,
        scoreDelta: this.scoreDelta,
        roomStatus: this.roomStatus,
        roundStatus: this.roundStatus,
        round: this.round,
        roundWinner: this.roundWinner,
        roundWins: this.roundWins,
        timeLeft: this.timeLeft,
        timeLimit: this.timeLimit,
        countdownLeft: this.countdownLeft,
        target: this.target,
        overallWinner: this.overallWinner,
        forfeitBy: this.forfeitBy,
        creator: this.creator,
      rematchVotes: this.rematchVotes,
      players: this.players,
      opponentId: this.opponentId,
      isRandomMatch: this.isRandomMatch,
      roundHistory: this.roundHistory,
        lastActivity: this.lastActivity,
        exitedPlayers: Array.from(this.exitedPlayers),
        disconnectedPlayers: Array.from(this.disconnectedPlayers),
        graceDeadline: this.graceDeadline,
        timerPaused: this.timerPaused,
      };
      await this.state.storage.put('room_state', JSON.stringify(data));
    } catch { /* ignore */ }
  }

  private handleHttpGet(): Response {
    const state = this.buildState();
    return new Response(JSON.stringify(state, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private scheduleCleanup(): void {
    if (this.cleanupTimer !== null) {
      clearTimeout(this.cleanupTimer);
    }
    // 5 分钟后检查
    this.cleanupTimer = setTimeout(() => {
      const now = Date.now();
      const allExited = this.players.length > 0 && this.players.every(p => this.exitedPlayers.has(p.playerId));
      if ((now - this.lastActivity > 5 * 60 * 1000 && this.connections.size === 0) || allExited) {
        // 清理房间
        this.destroyRoom();
      } else {
        this.scheduleCleanup();
      }
    }, 5 * 60 * 1000) as unknown as number;
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