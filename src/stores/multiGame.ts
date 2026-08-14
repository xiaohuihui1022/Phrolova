import { computed, ref, shallowRef } from "vue";
import { defineStore } from "pinia";

import type { Difficulty, MultiplayerRoomState, QuizType } from "@/types/game";
import { C2S, S2C } from "@/api";
import { generateRoomCode } from "@/multiplayer/protocol";
import { useAuthStore } from "./auth";
import {
  GameWebSocket,
  getGameSocket,
  releaseGameSocket,
  closeGameSocketAll,
  tryRecoverOnWsError,
} from "@/api/socket";
import { i18n } from "@/i18n";

type ConnectionState = "idle" | "connecting" | "connected" | "error";

// ── 主 Store ──
export const useMultiGameStore = defineStore("multiGame", () => {
  /** 当前活动 path（"/ws/matchmaker" 或 "/ws/room/<code>"），和单例 registry 对齐 */
  let currentPath: string | null = null;
  let gameWs: GameWebSocket | null = null;
  const connectionState = shallowRef<ConnectionState>("idle");
  const error = shallowRef("");
  const infoMessage = shallowRef("");
  const inQueue = shallowRef(false);
  /** 随机匹配成功、正在进入房间的过渡态：用于弹窗弥补连接房间期间的视觉空白 */
  const matched = shallowRef(false);
  /** 创建房间中、等待进入房间的过渡态：用于弹窗弥补创建+连接期间的视觉空白 */
  const creatingRoom = shallowRef(false);
  /** 加入房间中、等待进入房间的过渡态：用于弹窗弥补连接期间的视觉空白 */
  const joiningRoom = shallowRef(false);
  const roomState = ref<MultiplayerRoomState | null>(null);
  const kicked = shallowRef(false);
  const matchScoreDelta = ref(0);
  const roundResult = ref<{ roundWinner: number | null; myWins: number; opponentWins: number; iWon: boolean | null; answerText: string | null } | null>(null);
  // MATCH_FINISHED 消息到达计数器（响应式信号，让页面能直接监听该事件）
  const matchFinishedTrigger = ref(0);
  let _heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let _pendingQueue: { quizType: string; difficulty: string; bestOf: number } | null = null;

  // 用于等待 ROOM_STATE 的 Promise（用于 createRoom/joinRoom）
  let _roomStateResolve: (() => void) | null = null;
  let _roomStateReject: ((e: Error) => void) | null = null;
  let _waitingForRoomState = false;
  let _isTransitioning = false;
  let _inRoom = false;

  const LAST_ROOM_KEY = "phrolova_last_room_code";
  function saveLastRoomCode(roomCode: string): void {
    try { localStorage.setItem(LAST_ROOM_KEY, roomCode); } catch { /* ignore */ }
  }
  function clearLastRoomCode(): void {
    try { localStorage.removeItem(LAST_ROOM_KEY); } catch { /* ignore */ }
  }
  function getLastRoomCode(): string | null {
    try { return localStorage.getItem(LAST_ROOM_KEY); } catch { return null; }
  }

  const me = computed(() => roomState.value?.players.find((player) => player.isMe) ?? null);
  const opponent = computed(() => roomState.value?.players.find((player) => !player.isMe) ?? null);
  const canGuess = computed(() => {
    if (!roomState.value || !me.value) return false;
    return (
      roomState.value.roomStatus === "playing" &&
      roomState.value.roundStatus === "active" &&
      me.value.attemptsUsed < me.value.attemptsLimit
    );
  });

  /**
   * 释放上一条 path 的引用计数（切换连接前调用）。
   *   新的 path 若 == old path，getGameSocket 内部会只 +ref，因此对称 release 不会关闭；
   *   否则 ref 归零后 registry 条目自动关闭并移除。
   */
  function releaseCurrent(): void {
    if (currentPath) {
      releaseGameSocket(currentPath);
      currentPath = null;
      gameWs = null;
    }
  }

  function bindEvents() {
    if (!gameWs) return;

    gameWs.onMessage = async (msg) => {
      const { type, payload } = msg;

      switch (type) {
        case S2C.AUTHED:
          connectionState.value = "connected";
          error.value = "";
          infoMessage.value = (payload?.message as string) || i18n.global.t('multi.connected');
          break;

        case S2C.ERROR: {
          // 先尝试自动处理身份类错误（AUTH_EXPIRED / PLAYER_NOT_FOUND / AUTH_REQUIRED）
          if (currentPath) {
            const handled = await tryRecoverOnWsError(currentPath, payload ?? {});
            if (handled === 'handled') {
              // 已自动 toast/清态，不再在 error banner 重复显示
              break;
            }
          }
          const message = (payload?.message as string) || i18n.global.t('multi.errorOccurred');
          error.value = message;
          matched.value = false;
          creatingRoom.value = false;
          joiningRoom.value = false;
          if (_roomStateReject) {
            _roomStateReject(new Error(message));
            _roomStateReject = null;
            _roomStateResolve = null;
          }
          break;
        }

        case S2C.MATCHING:
          inQueue.value = (payload?.inQueue as boolean) ?? inQueue.value;
          infoMessage.value = (payload?.message as string) || i18n.global.t('multi.matchingUpdated');
          break;

        case S2C.ROOM_CREATED: {
          infoMessage.value = i18n.global.t('multi.roomCreated', { code: payload.roomCode });
          inQueue.value = false;
          if (!_isTransitioning && !_inRoom) {
            const roomCode = (payload.roomCode as string) || "";
            if (roomCode) {
              const config = { quizType: (payload.quizType as string) || "resonator", bestOf: Number(payload.bestOf) || 1, difficulty: (payload.difficulty as string) || "easy" };
              try {
                await transitionToRoom(roomCode, C2S.CREATE_ROOM, { roomCode, ...config });
              } catch (e) {
                error.value = e instanceof Error ? e.message : i18n.global.t('multi.connectRoomFailed');
                if (_roomStateReject) {
                  _roomStateReject(e instanceof Error ? e : new Error(String(e)));
                  _roomStateReject = null;
                  _roomStateResolve = null;
                }
              }
            }
          }
          break;
        }

        case S2C.ROOM_JOINED:
          infoMessage.value = i18n.global.t('multi.roomJoined', { code: payload.roomCode });
          inQueue.value = false;
          break;

        case S2C.COUNTDOWN_STARTED: {
          if (_inRoom || _isTransitioning) {
            infoMessage.value = i18n.global.t('multi.countdownInRoom', { sec: payload.countdownLeft ?? 3 });
            break;
          }
          infoMessage.value = i18n.global.t('multi.countdownMatched', { sec: payload.countdownLeft ?? 2 });
          inQueue.value = false;
          _pendingQueue = null;
          matched.value = true;
          const roomCode = (payload.roomCode as string) || "";
          if (roomCode) {
            _waitingForRoomState = true;
            try {
              await transitionToRoom(roomCode, C2S.JOIN_ROOM, {
                roomCode,
                quizType: (payload.quizType as QuizType) || 'resonator',
                bestOf: Number(payload.bestOf) || 3,
                difficulty: (payload.difficulty as Difficulty) || 'easy',
              });
            } catch (e) {
              matched.value = false;
              error.value = e instanceof Error ? e.message : i18n.global.t('multi.connectRoomFailed');
              if (_roomStateReject) {
                _roomStateReject(e instanceof Error ? e : new Error(String(e)));
                _roomStateReject = null;
                _roomStateResolve = null;
              }
            }
          } else {
            matched.value = false;
          }
          break;
        }

        case S2C.ROOM_STATE:
          const rawState = payload as unknown as MultiplayerRoomState;
          const authStore = useAuthStore();
          const processedState: MultiplayerRoomState = {
            ...rawState,
            players: rawState.players.map(p => ({
              ...p,
              isMe: p.playerId === authStore.playerId,
            })),
          };
          roomState.value = processedState;
          inQueue.value = false;
          matched.value = false;
          creatingRoom.value = false;
          joiningRoom.value = false;
          error.value = "";
          if (processedState.roomStatus === "waiting") {
            roundResult.value = null;
          }
          if (processedState.roomCode) {
            startHeartbeat();
            saveLastRoomCode(processedState.roomCode);
          }
          if (_waitingForRoomState && _roomStateResolve) {
            _waitingForRoomState = false;
            _isTransitioning = false;
            _inRoom = true;
            const resolve = _roomStateResolve;
            _roomStateResolve = null;
            _roomStateReject = null;
            resolve();
          } else {
            _isTransitioning = false;
          }
          break;

        case S2C.ROUND_STARTED:
          infoMessage.value = i18n.global.t('multi.roundStarted', { round: payload.round });
          break;

        case S2C.GUESS_RESULT:
          infoMessage.value = i18n.global.t('multi.guessSubmitted', { left: payload.attemptsLeft });
          break;

        case S2C.ROUND_FINISHED:
          infoMessage.value = i18n.global.t('multi.roundFinished');
          {
            const rs = roomState.value;
            if (rs && rs.bestOf > 1 && (payload.overallWinner === null || payload.overallWinner === undefined)) {
              const myIdx = rs.players.findIndex(p => p.isMe);
              const winnerIdx = payload.roundWinner as number | null | undefined;

              let iWon: boolean | null = null;
              if (winnerIdx === null || winnerIdx === undefined) {
                iWon = null;
              } else if (myIdx < 0) {
                const resultStr = (payload.roundResult as string) ?? "";
                if (resultStr === "win") iWon = true;
                else if (resultStr === "loss") iWon = false;
                else iWon = null;
              } else {
                iWon = winnerIdx === myIdx;
              }

              const newRoundWins = (payload.roundWins as number[]) ?? [0, 0];
              let myWins: number;
              let oppWins: number;
              if (myIdx < 0) {
                myWins = newRoundWins[0] ?? 0;
                oppWins = newRoundWins[1] ?? 0;
              } else {
                myWins = newRoundWins[myIdx] ?? 0;
                oppWins = newRoundWins[1 - myIdx] ?? 0;
              }

              roundResult.value = {
                roundWinner: winnerIdx ?? null,
                myWins,
                opponentWins: oppWins,
                iWon,
                answerText: (payload.target && typeof payload.target === 'object' && 'name' in payload.target)
                  ? String((payload.target as Record<string, unknown>).name)
                  : null,
              };
            }
          }
          break;

        case S2C.MATCH_FINISHED: {
          const rawDelta = (payload.scoreDelta as number) || 0;
          const winner = payload.overallWinner as number | null | undefined;
          const forfeitPid = (payload.forfeitPlayerId as string | null | undefined) ?? null;
          const rs = roomState.value;
          const myIdx = rs ? rs.players.findIndex(p => p.isMe) : 0;
          const isViewpoint0 = myIdx === 0 || myIdx < 0;
          let myDelta = isViewpoint0 ? rawDelta : -rawDelta;
          if (winner === null) myDelta = 0;
          matchScoreDelta.value = myDelta;

          if (roomState.value) {
            const s = roomState.value;
            if (forfeitPid) {
              s.forfeitBy = forfeitPid;
            }
            if (winner !== undefined) {
              s.overallWinner = winner;
            }
            roomState.value = { ...s };
          }
          matchFinishedTrigger.value++;

          infoMessage.value =
            myDelta > 0
              ? i18n.global.t('multi.matchWon', { delta: myDelta })
              : myDelta < 0
                ? i18n.global.t('multi.matchLost', { delta: myDelta })
                : i18n.global.t('multi.matchDraw');
          stopHeartbeat();
          clearLastRoomCode();
          break;
        }

        case S2C.OPPONENT_FORFEIT:
          matchScoreDelta.value = (payload.scoreDelta as number) || 0;
          if (roomState.value) {
            const s = roomState.value;
            const meP = s.players.find(p => p.isMe);
            const opponentP = s.players.find(p => !p.isMe);
            s.forfeitBy = opponentP?.playerId ?? null;
            s.overallWinner = meP ? s.players.indexOf(meP) : 0;
            s.roomStatus = "finished";
            roomState.value = { ...s };
          }
          matchFinishedTrigger.value++;
          infoMessage.value = (payload.message as string) || i18n.global.t('multi.opponentForfeit');
          stopHeartbeat();
          clearLastRoomCode();
          break;

        case S2C.ROOM_EXPIRED:
          infoMessage.value = (payload?.message as string) || i18n.global.t('multi.roomExpired');
          roomState.value = null;
          inQueue.value = false;
          stopHeartbeat();
          clearLastRoomCode();
          break;

        case S2C.KICKED:
          if (!kicked.value) {
            disconnect();
            kicked.value = true;
          }
          break;

        case S2C.PONG:
          break;
      }
    };

    gameWs.onOpen = () => {
      connectionState.value = "connected";
      error.value = "";
      if (_pendingQueue && !_inRoom) {
        gameWs?.send(C2S.QUEUE_JOIN, _pendingQueue);
      }
    };

    gameWs.onClose = () => {
      if (connectionState.value === "connected" || connectionState.value === "connecting") {
        connectionState.value = "idle";
        // 仅在 socket 层 toast 没覆盖到时再补充 banner（避免重复报给用户）
        if (!error.value) error.value = i18n.global.t('multi.disconnected');
        if (!_pendingQueue) {
          inQueue.value = false;
        }
        _inRoom = false;
        stopHeartbeat();
      }
    };

    gameWs.onError = () => {
      // 错误事件仅通知，具体错误状态由 onClose/onOpen 决定
    };
  }

  function startHeartbeat() {
    stopHeartbeat();
    _heartbeatTimer = setInterval(() => {
      if (gameWs?.connected && roomState.value?.roomCode) {
        gameWs.send(C2S.HEARTBEAT, { roomCode: roomState.value.roomCode });
      }
    }, 60000);
  }

  function stopHeartbeat() {
    if (_heartbeatTimer) {
      clearInterval(_heartbeatTimer);
      _heartbeatTimer = null;
    }
  }

  async function ensureConnected(path: string = ""): Promise<GameWebSocket> {
    const authStore = useAuthStore();
    if (!authStore.isAuthenticated) {
      throw new Error(i18n.global.t('multi.loginRequired'));
    }

    connectionState.value = "connecting";
    try {
      const ws = await getGameSocket(path, {
        /* handlers 占位：bindEvents 在下面会覆盖 onMessage/onOpen/onClose/onError */
      });
      // 拿到新 ws 后：更新 release 配对（只有路径变化时才需要 release 旧的）
      if (currentPath && currentPath !== path) {
        releaseGameSocket(currentPath);
      }
      currentPath = path;
      gameWs = ws;
      bindEvents();
      return ws;
    } catch (e) {
      connectionState.value = "error";
      error.value = e instanceof Error ? e.message : i18n.global.t('multi.connectFailed');
      throw e;
    }
  }

  async function transitionToRoom(roomCode: string, action: string, payload: Record<string, unknown>): Promise<void> {
    _isTransitioning = true;
    const roomPath = `/ws/room/${roomCode}`;
    try {
      const ws = await ensureConnected(roomPath);
      ws.send(action, payload);
      if (_waitingForRoomState) {
        await waitForRoomState();
      }
    } catch (e) {
      _isTransitioning = false;
      const msg = e instanceof Error ? e.message : i18n.global.t('multi.connectRoomFailed');
      error.value = msg;
      throw e;
    }
  }

  function waitForRoomState(timeoutMs: number = 15000): Promise<void> {
    if (_waitingForRoomState && _roomStateResolve && _roomStateReject) {
      return new Promise<void>((resolve, reject) => {
        const prevResolve = _roomStateResolve!;
        const prevReject = _roomStateReject!;
        _roomStateResolve = () => {
          prevResolve();
          resolve();
        };
        _roomStateReject = (e: Error) => {
          prevReject(e);
          reject(e);
        };
      });
    }

    return new Promise((resolve, reject) => {
      _roomStateResolve = resolve;
      _roomStateReject = reject;
      _waitingForRoomState = true;

      setTimeout(() => {
        if (_roomStateReject) {
          _roomStateReject(new Error(i18n.global.t('multi.connectTimeout')));
          _roomStateReject = null;
          _roomStateResolve = null;
          _waitingForRoomState = false;
          _isTransitioning = false;
        }
      }, timeoutMs);
    });
  }

  async function ensureRoomConnection(roomCode: string): Promise<GameWebSocket> {
    const path = `/ws/room/${roomCode}`;
    return ensureConnected(path);
  }

  async function ensureMatchmakerConnection(): Promise<GameWebSocket> {
    return ensureConnected("/ws/matchmaker");
  }

  async function resumeRoom(): Promise<void> {
    const authStore = useAuthStore();
    if (!authStore.isAuthenticated) return;
    if (_inRoom && roomState.value) return;
    const lastRoomCode = getLastRoomCode();
    if (!lastRoomCode) return;
    _waitingForRoomState = true;
    try {
      const ws = await ensureConnected(`/ws/room/${lastRoomCode}`);
      ws.send(C2S.RESUME_ROOM);
      await waitForRoomState();
    } catch (e) {
      clearLastRoomCode();
      roomState.value = null;
      _waitingForRoomState = false;
      _isTransitioning = false;
      throw e;
    }
  }

  async function createRoom(quizType: QuizType, bestOf: number, difficulty: Difficulty): Promise<void> {
    _waitingForRoomState = true;
    _isTransitioning = true;
    creatingRoom.value = true;
    try {
      const roomCode = generateRoomCode();
      const ws = await ensureConnected(`/ws/room/${roomCode}`);
      ws.send(C2S.CREATE_ROOM, { roomCode, quizType, bestOf, difficulty });
      await waitForRoomState();
    } catch (e) {
      _waitingForRoomState = false;
      _isTransitioning = false;
      creatingRoom.value = false;
      throw e;
    }
  }

  async function joinRoom(roomCode: string): Promise<void> {
    _waitingForRoomState = true;
    joiningRoom.value = true;
    try {
      const ws = await ensureConnected(`/ws/room/${roomCode}`);
      ws.send(C2S.JOIN_ROOM, { roomCode });
      await waitForRoomState();
    } catch (e) {
      joiningRoom.value = false;
      throw e;
    }
  }

  async function joinQueue(quizType: QuizType, difficulty: Difficulty, bestOf: number): Promise<void> {
    _pendingQueue = { quizType, difficulty, bestOf };
    const ws = await ensureConnected("/ws/matchmaker");
    inQueue.value = true;
    ws.send(C2S.QUEUE_JOIN, { quizType, difficulty, bestOf });
  }

  async function cancelQueue(): Promise<void> {
    _pendingQueue = null;
    if (gameWs) {
      gameWs.send(C2S.QUEUE_CANCEL);
    }
    inQueue.value = false;
  }

  async function submitGuess(guessName: string): Promise<void> {
    if (!roomState.value) {
      throw new Error(i18n.global.t('multi.notInRoom'));
    }
    if (!gameWs?.connected) {
      throw new Error(i18n.global.t('multi.wsNotConnected'));
    }
    gameWs.send(C2S.SUBMIT_GUESS, {
      roomCode: roomState.value.roomCode,
      guessName,
    });
  }

  async function leaveRoom(): Promise<void> {
    if (roomState.value) {
      if (gameWs) {
        gameWs.send(C2S.LEAVE_ROOM, { roomCode: roomState.value.roomCode });
      }
    }
    clearLastRoomCode();
    roomState.value = null;
    inQueue.value = false;
    _inRoom = false;
    stopHeartbeat();
  }

  function restartRoom(): void {
    if (!roomState.value || !gameWs) return;
    gameWs.send(C2S.RESTART_ROOM, { roomCode: roomState.value.roomCode });
  }

  /** 玩家标记自己已准备（仅"创建房间"路径，非房主玩家调用） */
  function sendReady(): void {
    if (!roomState.value || !gameWs) return;
    gameWs.send(C2S.PLAYER_READY, { roomCode: roomState.value.roomCode });
  }

  /** 房主手动开始对局（仅"创建房间"路径，房主调用） */
  function startMatch(): void {
    if (!roomState.value || !gameWs) return;
    gameWs.send(C2S.START_MATCH, { roomCode: roomState.value.roomCode });
  }

  function disconnect(): void {
    stopHeartbeat();
    clearLastRoomCode();
    // 释放当前 path 的引用（若 ref>1 则 registry 不会立刻关，引用计数会自行归零）
    releaseCurrent();
    closeGameSocketAll();
    currentPath = null;
    gameWs = null;
    connectionState.value = "idle";
    inQueue.value = false;
    matched.value = false;
    creatingRoom.value = false;
    joiningRoom.value = false;
    _inRoom = false;
    _isTransitioning = false;
    _waitingForRoomState = false;
    roomState.value = null;
    kicked.value = false;
    matchScoreDelta.value = 0;
    roundResult.value = null;
  }

  return {
    connectionState,
    error,
    infoMessage,
    inQueue,
    matched,
    creatingRoom,
    joiningRoom,
    roomState,
    me,
    opponent,
    canGuess,
    kicked,
    matchScoreDelta,
    roundResult,
    matchFinishedTrigger,
    ensureConnected,
    resumeRoom,
    createRoom,
    joinRoom,
    joinQueue,
    cancelQueue,
    submitGuess,
    leaveRoom,
    restartRoom,
    sendReady,
    startMatch,
    disconnect,
  };
});
