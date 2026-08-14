<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch } from "vue";
import { useRouter, onBeforeRouteLeave } from "vue-router";
import { useI18n } from "vue-i18n";
import gsap from "gsap";

import FeedbackLegend from "@/components/game/FeedbackLegend.vue";
import GuessTable from "@/components/game/GuessTable.vue";
import NameAutocompleteInput from "@/components/game/NameAutocompleteInput.vue";
import MatchSummary from "@/components/multi/MatchSummary.vue";
import GlassHeader from "@/components/shared/GlassHeader.vue";
import ModalOverlay from "@/components/shared/ModalOverlay.vue";
import EmptyState from "@/components/shared/EmptyState.vue";
import { writeLocalStorage } from "@/composables/useStorage";
import { useAuthStore } from "@/stores/auth";
import { useDictionaryStore } from "@/stores/dictionary";
import { useMultiGameStore } from "@/stores/multiGame";

let ctx: gsap.Context | null = null;

const authStore = useAuthStore();
const dictionaryStore = useDictionaryStore();
const multiGameStore = useMultiGameStore();
const router = useRouter();
const { t } = useI18n();
const guessName = shallowRef("");
const guessInputRef = useTemplateRef<{ focus: () => void; resolveFinalName: () => string }>("guessInput");

type BoardLayout = "rows" | "columns";
const LAYOUT_STORAGE_KEY = "phrolova_multi_board_layout";
const boardLayout = ref<BoardLayout>(
  (localStorage.getItem(LAYOUT_STORAGE_KEY) as BoardLayout) ?? "rows",
);

function toggleBoardLayout() {
  boardLayout.value = boardLayout.value === "rows" ? "columns" : "rows";
  localStorage.setItem(LAYOUT_STORAGE_KEY, boardLayout.value);
}

const names = computed(() =>
  multiGameStore.roomState?.quizType === "skeleton" ? dictionaryStore.skeletonNames : dictionaryStore.resonatorNames,
);

const battleTitle = computed(() => {
  if (!multiGameStore.roomState) return t("multi.realtimeBattle");
  if (multiGameStore.roomState.quizType === "skeleton") {
    return multiGameStore.roomState.difficulty === "easy" ? t("multi.skeletonBattleEasy") : t("multi.skeletonBattleHard");
  }
  return t("multi.resonatorBattle");
});

// 是否为房主（创建房间路径下房主通过"开始对局"按钮启动对局）
const isCreator = computed(() =>
  multiGameStore.roomState?.creator === authStore.playerId,
);

// 非房主玩家对象（需要点击"准备"的一方）
const guestPlayer = computed(() =>
  multiGameStore.roomState?.players.find(
    (p) => p.playerId !== multiGameStore.roomState?.creator,
  ) ?? null,
);

// 非房主玩家是否已准备
const guestReady = computed(() => guestPlayer.value?.ready ?? false);

// 我自己是否已准备（房主不参与准备，恒为 false）
const myReady = computed(() => {
  if (isCreator.value) return false;
  return multiGameStore.me?.ready ?? false;
});

// 房主是否可以点击"开始对局"：双方在场且非房主已准备
const canStartMatch = computed(() =>
  !!multiGameStore.roomState &&
  multiGameStore.roomState.players.length >= 2 &&
  guestReady.value,
);

// 是否显示"准备/开始"面板：仅创建房间路径 + waiting + 双方在场
const showReadyPanel = computed(() => {
  const rs = multiGameStore.roomState;
  if (!rs) return false;
  return rs.roomStatus === "waiting" && rs.isRandomMatch === false && rs.players.length >= 2;
});

const stagePromptTitle = computed(() => {
  const rs = multiGameStore.roomState;
  if (!rs) return "";
  if (rs.roomStatus === "waiting") {
    if (!multiGameStore.opponent) return t("multi.waitingOpponentJoin");
    // 随机匹配路径：自动开始
    if (rs.isRandomMatch) return t("multi.opponentJoinedStarting");
    // 创建房间路径：根据角色显示不同提示
    if (isCreator.value) {
      return guestReady.value ? t("multi.clickToStart") : t("multi.waitingOpponentReady");
    }
    return myReady.value ? t("multi.readyWaitingHost") : t("multi.clickReadyToStart");
  }
  if (rs.roomStatus === "countdown") return t("multi.matchStarting");
  if (rs.quizType === "skeleton") return t("multi.skeletonRealtimePrompt");
  return t("multi.resonatorRealtimePrompt");
});

const stagePromptSubtitle = computed(() => t("multi.stageSubtitle"));

const hasBattleHistory = computed(() =>
  Boolean((multiGameStore.me?.guesses.length ?? 0) || (multiGameStore.opponent?.guesses.length ?? 0)),
);

const roomHintText = computed(() => {
  const roomState = multiGameStore.roomState;
  if (!roomState) return "";
  const timer = roomState.countdownLeft || roomState.timeLeft || 0;
  return t("multi.roomHeader", { code: roomState.roomCode, round: roomState.round, bestOf: roomState.bestOf, timer });
});

const answerText = computed(() => multiGameStore.roomState?.target?.name ?? "");

const dockHintText = computed(() => {
  const rs = multiGameStore.roomState;
  if (!rs) return "";
  if (multiGameStore.canGuess) return t("multi.yourTurn");
  if (rs.roomStatus === "countdown") return t("multi.matchStarting");
  if (rs.roomStatus === "waiting") {
    if (!multiGameStore.opponent) return t("multi.waitingOpponentJoin");
    // 随机匹配路径：自动开始
    if (rs.isRandomMatch) return t("multi.opponentJoinedStarting");
    // 创建房间路径：根据角色提示
    if (isCreator.value) return guestReady.value ? t("multi.clickToStart") : t("multi.waitingOpponentReady");
    return myReady.value ? t("multi.readyWaitingHost") : t("multi.clickReadyToStart");
  }
  return t("multi.waitingSystem");
});

const myWins = computed(() => multiGameStore.me?.roundWins ?? 0);
const opponentWins = computed(() => multiGameStore.opponent?.roundWins ?? 0);
const opponentLabel = computed(() => {
  const opp = multiGameStore.opponent;
  const oppId = opp?.playerId || multiGameStore.roomState?.opponentId || "";
  if (!oppId) return t("multi.waitingJoin");
  return opp?.dbId != null ? `${oppId} #${opp.dbId}` : oppId;
});
const targetBestOf = computed(() => multiGameStore.roomState?.bestOf ?? 1);
const winsNeeded = computed(() => Math.ceil(targetBestOf.value / 2));

const myGuesses = computed(() =>
  (multiGameStore.me?.guesses ?? []).map((row) => ({ ...row, revealed: true })),
);

// 平局后对手猜测也要能看到答案：roundStatus 为 resolved/finished 时强制 revealed=true
// 否则保留原有 revealed 字段（仅在对手猜中时 revealed=true）
const opponentGuesses = computed(() => {
  const rs = multiGameStore.roomState;
  const revealAll = rs?.roundStatus === "resolved" || rs?.roomStatus === "finished";
  return (multiGameStore.opponent?.guesses ?? []).map((row) => ({
    ...row,
    revealed: revealAll ? true : Boolean(row.revealed),
  }));
});

const showMatchResult = ref(false);
const matchResultSeen = ref(false);
const showRoundPopup = ref(false);
// 点击「继续游戏」后进入等待对方同意状态；对方也点后房间重置到 waiting，弹窗自然关闭
const rematchPending = ref(false);
let roundPopupTimer: ReturnType<typeof setTimeout> | null = null;

/** 我方猜测滚动容器（每块 panel 内独立滚动，避免整页被顶下去手动划） */
const myBoardBody = ref<HTMLElement | null>(null);

/** 将目标滚动容器滚到底部；同时兼容内层 .guess-table-shell 自身的 overflow:auto */
function scrollBoardToBottom(el: HTMLElement | null) {
  if (!el) return;
  el.scrollTop = el.scrollHeight;
  const innerShell = el.querySelector<HTMLElement>(".guess-table-shell");
  if (innerShell) innerShell.scrollTop = innerShell.scrollHeight;
}

/** 只在我方提交新猜测时滚到底部，对手新条目触发 opponentGuesses 变化时不动 */
let _lastMyGuessesLength = 0;
function watchMyGuesses(len: number) {
  if (len > _lastMyGuessesLength) {
    // 双保险：nextTick 等 Vue 渲染，再等一帧确保 CSS 渐入动画与表格布局已完成
    nextTick(() => {
      requestAnimationFrame(() => {
        scrollBoardToBottom(myBoardBody.value);
        // 极慢设备上再补一次，避免动画最终帧完成后又露出空白
        setTimeout(() => scrollBoardToBottom(myBoardBody.value), 60);
      });
    });
  }
  _lastMyGuessesLength = len;
}
watch(
  () => myGuesses.value.length,
  watchMyGuesses,
);

// 新 round 开始时清零计数（防止 round 切换后 len 从大变小再变大时误滚）
watch(
  () => multiGameStore.roomState?.round,
  (newRound, oldRound) => {
    _lastMyGuessesLength = 0;
    // 新 round 第一条之前先滚回顶部，避免处于上一轮底部遮挡内容
    if (newRound !== undefined && newRound !== oldRound) {
      nextTick(() => {
        const el = myBoardBody.value;
        if (el) el.scrollTop = 0;
      });
    }
  },
);

// 初始挂载或重连时：如果已有我方猜测，也滚到最底下一次，避免停留在顶部挡住最新一条
onMounted(() => {
  if (myGuesses.value.length > 0) {
    _lastMyGuessesLength = myGuesses.value.length;
    nextTick(() => {
      requestAnimationFrame(() => scrollBoardToBottom(myBoardBody.value));
    });
  }
});

// Show round result popup for BO3/BO5
watch(
  () => multiGameStore.roundResult,
  (result) => {
    if (result) {
      showRoundPopup.value = true;
      if (roundPopupTimer) clearTimeout(roundPopupTimer);
      roundPopupTimer = setTimeout(() => {
        showRoundPopup.value = false;
        multiGameStore.roundResult = null;
      }, 5000);
    }
  },
);

// 双保险：监听 roomStatus 变为 finished 触发弹窗
watch(
  () => multiGameStore.roomState?.roomStatus,
  (status) => {
    if (status === "finished" && !matchResultSeen.value) {
      showMatchResult.value = true;
      matchResultSeen.value = true;
    }
    if (status !== "finished") {
      matchResultSeen.value = false;
      // 房间离开 finished（对方同意继续游戏，已重置到 waiting/countdown）
      // 关闭弹窗、重置等待状态，让准备面板或倒计时正常显示
      showMatchResult.value = false;
      rematchPending.value = false;
    }
  },
);

// 双保险：监听 matchScoreDelta 非 0 或 overallWinner 有值时触发弹窗（处理 MATCH_FINISHED 先于 ROOM_STATE 到达的情况）
watch(
  [
    () => multiGameStore.matchScoreDelta,
    () => multiGameStore.roomState?.overallWinner,
  ],
  ([delta, overallWinner]) => {
    const rs = multiGameStore.roomState;
    const isFinished = rs?.roomStatus === "finished";
    const hasResult = (delta !== 0) || (overallWinner !== null && overallWinner !== undefined);
    if (isFinished && hasResult && !matchResultSeen.value) {
      showMatchResult.value = true;
      matchResultSeen.value = true;
    }
  },
);

// 第三道保险：直接监听 MATCH_FINISHED 事件到达信号（最可靠的触发方式）
watch(
  () => multiGameStore.matchFinishedTrigger,
  (trigger) => {
    if (trigger > 0 && !matchResultSeen.value) {
      // 延迟一帧，确保 roomState 更新完成后再判断
      nextTick(() => {
        if (!matchResultSeen.value) {
          showMatchResult.value = true;
          matchResultSeen.value = true;
        }
      });
    }
  },
);

type MatchOutcome = "unknown" | "lostByForfeit" | "winByForfeit" | "draw" | "victory" | "defeat";

const matchOutcome = computed<MatchOutcome>(() => {
  const rs = multiGameStore.roomState;
  if (!rs) return "unknown";

  // 优先判断弃权场景
  const forfeitBy = rs.forfeitBy;
  if (forfeitBy) {
    return forfeitBy === authStore.playerId ? "lostByForfeit" : "winByForfeit";
  }

  // 正常胜负判定：基于 overallWinner
  if (rs.overallWinner === null || rs.overallWinner === undefined) {
    return "draw";
  }
  const myIdx = rs.players.findIndex(p => p.isMe);
  return rs.overallWinner === myIdx ? "victory" : "defeat";
});

const matchResultText = computed(() => t(`multi.${matchOutcome.value}`));

const isWinLike = computed(() => matchOutcome.value === "victory" || matchOutcome.value === "winByForfeit");
const isDraw = computed(() => matchOutcome.value === "draw");

const matchScoreText = computed(() => {
  const d = multiGameStore.matchScoreDelta;
  if (!d) return "";
  return d > 0 ? t("multi.scorePlus", { n: d }) : t("multi.scoreMinus", { n: d });
});

// 对手处于重连宽限期（断开连接但尚未超时弃权）
const opponentReconnecting = computed(() => {
  const rs = multiGameStore.roomState;
  if (!rs?.reconnectingPlayers || rs.reconnectingPlayers.length === 0) return false;
  const opp = rs.players.find(p => !p.isMe);
  return opp ? rs.reconnectingPlayers.includes(opp.playerId) : false;
});

// 重连 banner 文案：不同阶段对应的后续处理不同
const reconnectBannerText = computed(() => {
  const status = multiGameStore.roomState?.roomStatus;
  if (status === "playing") return t("multi.reconnectPlaying");
  if (status === "finished") return t("multi.reconnectFinished");
  return t("multi.reconnectWaiting");
});

function closeMatchResult() { showMatchResult.value = false; }

function openFullResultPage() {
  if (!multiGameStore.roomState) return;
  writeLocalStorage("phrolova_match_result", {
    roomState: multiGameStore.roomState,
    scoreDelta: multiGameStore.matchScoreDelta,
    myPlayerId: authStore.playerId,
  });
  showMatchResult.value = false;
  router.push({ name: "multi-result" });
}

async function submitGuess(finalName?: string) {
  const name = (finalName ?? guessName.value).trim();
  if (!name) return;
  try {
    await multiGameStore.submitGuess(name);
    guessName.value = "";
    await nextTick();
  } catch { /* ignore */ }
}

/** 点击提交按钮：使用组件内部逻辑 resolveFinalName 获取最终名称（考虑 activeIndex）。 */
function handleClickSubmit() {
  const finalName = guessInputRef.value?.resolveFinalName() ?? guessName.value;
  submitGuess(finalName);
}

async function leaveRoom() {
  await multiGameStore.leaveRoom().catch(() => undefined);
  router.push("/multi");
}

/** 非房主玩家点击"准备" */
function onReady() {
  multiGameStore.sendReady();
}

/** 房主点击"开始对局" */
function onStartMatch() {
  multiGameStore.startMatch();
}

/** 结算弹窗点击"继续游戏"：发送 RESTART_ROOM，进入等待对方同意状态
 *  对方也点后房间重置到 waiting，watch roomStatus 会自动关闭弹窗
 */
function handleContinueGame() {
  if (rematchPending.value) return;
  multiGameStore.restartRoom();
  rematchPending.value = true;
}

onMounted(async () => {
  nextTick(() => {
    ctx = gsap.context(() => {
      gsap.from(".mr-glass-header", { opacity: 0, y: -20, duration: 0.45, ease: "power2.out" });
      gsap.from(".mr-info-card", { opacity: 0, y: 16, duration: 0.4, ease: "power2.out", delay: 0.08 });
      gsap.from(".mr-stage", { opacity: 0, y: 20, duration: 0.5, ease: "power2.out", delay: 0.14 });
      gsap.from(".mr-dock", { opacity: 0, y: 12, duration: 0.4, ease: "power2.out", delay: 0.2 });
    });
  });
  if (!authStore.isAuthenticated) { router.push("/auth"); return; }
  await multiGameStore.resumeRoom().catch(() => undefined);
  if (multiGameStore.roomState) {
    await dictionaryStore.ensureLoaded(multiGameStore.roomState.quizType);
  }
  // 从对局回放页"返回房间"或重连回来时，组件重挂载但 store 内 roomState 已是 finished，
  // watch 不会因为值没变而触发弹窗，因此此处主动补一次显示
  const rs = multiGameStore.roomState;
  if (rs?.roomStatus === "finished" && !matchResultSeen.value) {
    const hasResult =
      (multiGameStore.matchScoreDelta !== 0) ||
      (rs.overallWinner !== null && rs.overallWinner !== undefined);
    if (hasResult) {
      showMatchResult.value = true;
      matchResultSeen.value = true;
    }
  }
});

onBeforeUnmount(() => {
  ctx?.revert();
  if (roundPopupTimer) clearTimeout(roundPopupTimer);
});

// 任何方式离开 Room 页面（返回按钮、关闭标签、router.push）都先清理房间状态
// 这样 localStorage 中不会残留 roomCode，避免刷新后误重连
// 例外：导航到对局回放页面时保留房间状态，允许用户返回继续操作
onBeforeRouteLeave(async (to, _from, next) => {
  if (to.name === "multi-result") {
    next();
    return;
  }
  try {
    await multiGameStore.leaveRoom();
  } catch { /* ignore */ }
  next();
});

watch(
  () => multiGameStore.roomState?.quizType,
  async (quizType) => { if (!quizType) return; await dictionaryStore.ensureLoaded(quizType); },
);
</script>

<template>
  <div class="game-screen">
    <template v-if="multiGameStore.roomState">
      <div class="game-shell">
        <GlassHeader
          class="mr-glass-header"
          :kicker="t('multi.roomKicker')"
          :title="battleTitle"
          back-to="/multi"
        >
          <template #actions>
            <span class="mr-glass-chip">{{ roomHintText }}</span>
            <button
              v-if="hasBattleHistory"
              class="mr-layout-toggle glass-header-btn"
              :title="boardLayout === 'rows' ? t('multi.toggleLayoutRows') : t('multi.toggleLayoutCols')"
              @click="toggleBoardLayout"
            >
              <Icon :icon="boardLayout === 'rows' ? 'ph:columns-duotone' : 'ph:rows-duotone'" aria-hidden="true" />
            </button>
            <button class="glass-header-btn glass-header-btn--danger" @click="leaveRoom" :title="t('multi.exitRoom')">
              <Icon icon="ph:sign-out-duotone" aria-hidden="true" />
            </button>
          </template>
        </GlassHeader>

        <div v-if="opponentReconnecting" class="mr-reconnect-banner">
          <Icon icon="ph:plugs-connected-duotone" class="mr-reconnect-icon" />
          <span>{{ reconnectBannerText }}</span>
        </div>
        <div class="mr-info-card">
          <MatchSummary :room-state="multiGameStore.roomState" />
          <div class="mr-info-divider" />
          <div class="mr-score-panel">
            <div class="score-bar" style="border:none;background:transparent;padding:0">
              <div class="score-item">
                <span class="score-label">{{ t("multi.mine") }}</span>
                <span class="score-value" :class="{ 'score-value--accent': myWins >= winsNeeded }">{{ myWins }}</span>
              </div>
              <div class="score-divider">VS</div>
              <div class="score-item">
                <span class="score-label">{{ t("multi.opponent") }}</span>
                <span class="score-value" :class="{ 'score-value--accent': opponentWins >= winsNeeded }">{{ opponentWins }}</span>
              </div>
              <div class="score-divider score-divider--gap">·</div>
              <div class="score-item">
                <span class="score-label">{{ t("multi.firstToWin") }}</span>
                <span class="score-value score-value--accent">{{ winsNeeded }}</span>
              </div>
            </div>
          </div>
        </div>

        <section class="game-stage mr-stage" :class="{ 'game-stage--empty': !hasBattleHistory }">
          <div class="stage-head">
            <div class="stage-copy">
              <p class="stage-kicker">ARENA</p>
              <h2 class="stage-title">{{ hasBattleHistory ? t("multi.bothProgress") : stagePromptTitle }}</h2>
              <p class="stage-sub">{{ hasBattleHistory ? stagePromptSubtitle : roomHintText }}</p>
            </div>
            <FeedbackLegend v-if="hasBattleHistory" />
          </div>

          <div v-if="!hasBattleHistory" class="empty-state">
            <div class="empty-state-glyph"><Icon icon="ph:target-duotone" aria-hidden="true" /></div>
            <h2 class="empty-state-title">{{ stagePromptTitle }}</h2>
            <p class="empty-state-desc">{{ stagePromptSubtitle }}</p>

            <!-- 准备/开始面板：仅"创建房间"路径 + waiting + 双方在场时显示 -->
            <div v-if="showReadyPanel" class="mr-ready-panel">
              <div class="mr-ready-status">
                <div class="mr-ready-chip" :class="{ 'is-ready': guestReady }">
                  <Icon
                    :icon="guestReady ? 'ph:check-circle-duotone' : 'ph:circle-duotone'"
                    class="mr-ready-chip-icon"
                    aria-hidden="true"
                  />
                  <span class="mr-ready-chip-label">{{ isCreator ? t("multi.chipOpponent") : t("multi.chipYou") }}</span>
                  <span class="mr-ready-chip-tag">{{ guestReady ? t("multi.ready") : t("multi.notReady") }}</span>
                </div>
              </div>

              <!-- 房主：开始对局按钮 -->
              <button
                v-if="isCreator"
                class="btn btn-submit mr-ready-btn"
                :disabled="!canStartMatch"
                @click="onStartMatch"
              >
                <Icon icon="ph:play-duotone" class="btn-icon" aria-hidden="true" />
                {{ t("multi.startMatchBtn") }}
              </button>

              <!-- 非房主：准备按钮 -->
              <button
                v-else-if="!myReady"
                class="btn btn-submit mr-ready-btn"
                @click="onReady"
              >
                <Icon icon="ph:check-duotone" class="btn-icon" aria-hidden="true" />
                {{ t("multi.readyBtn") }}
              </button>

              <!-- 非房主已准备：等待提示 -->
              <p v-else class="mr-ready-waiting">{{ t("multi.readyWaitingHostLong") }}</p>
            </div>
          </div>

          <div v-if="hasBattleHistory" class="mr-boards" :class="`mr-boards--${boardLayout}`">
            <div class="mr-board-panel">
              <div class="mr-board-head">
                <h3 class="mr-board-title"><Icon icon="ph:user-duotone" class="mr-board-head-icon" /> {{ t("multi.myGuessesTitle") }}</h3>
                <span class="mr-board-meta">{{ multiGameStore.me?.attemptsUsed ?? 0 }} / {{ multiGameStore.me?.attemptsLimit ?? 0 }}</span>
              </div>
              <div ref="myBoardBody" class="mr-board-body">
                <GuessTable
                  :quiz-type="multiGameStore.roomState.quizType"
                  :rows="myGuesses"
                  :empty-label="t('multi.emptyMyGuesses')"
                  :target-version="multiGameStore.roomState.targetVersion"
                  :target-cost="multiGameStore.roomState.targetCost"
                />
              </div>
            </div>

            <div class="mr-board-panel">
              <div class="mr-board-head">
                <h3 class="mr-board-title"><Icon icon="ph:user-circle-duotone" class="mr-board-head-icon" /> {{ t("multi.opponentGuessesTitle") }}</h3>
                <span class="mr-board-meta">{{ opponentLabel }}</span>
              </div>
              <div class="mr-board-body">
                <GuessTable
                  :quiz-type="multiGameStore.roomState.quizType"
                  :rows="opponentGuesses"
                  :empty-label="t('multi.emptyOpponentGuesses')"
                  :target-version="multiGameStore.roomState.targetVersion"
                  :target-cost="multiGameStore.roomState.targetCost"
                />
              </div>
            </div>
          </div>
        </section>

        <footer class="game-dock mr-dock">
          <div class="dock-copy">
            <span class="dock-label"><Icon icon="ph:keyboard-duotone" class="dock-label-icon" /> {{ t("single.submitGuess") }}</span>
            <span class="dock-meta">{{ dockHintText }}</span>
          </div>
          <div class="dock-input-row">
            <NameAutocompleteInput
              ref="guessInput"
              v-model="guessName"
              :disabled="!multiGameStore.canGuess"
              :names="names"
              :quiz-type="multiGameStore.roomState?.quizType"
              :placeholder="multiGameStore.roomState?.quizType === 'skeleton' ? t('single.skeletonPlaceholder') : t('single.resonatorPlaceholder')"
              @submit="submitGuess"
            />
            <button class="btn btn-submit" :disabled="!multiGameStore.canGuess" @click="handleClickSubmit">
              <Icon icon="ph:paper-plane-right-duotone" class="btn-icon" /> {{ t("single.submit") }}
            </button>
          </div>
        </footer>
      </div>
    </template>

    <div v-else class="mr-empty-shell">
      <EmptyState icon="ph:warning-circle-duotone" kicker="NOTICE" :title="t('multi.noActiveRoom')" :description="t('multi.noActiveRoomDesc')">
        <RouterLink class="btn" to="/multi" style="display:inline-flex;text-decoration:none">{{ t("multi.backToLobby") }}</RouterLink>
      </EmptyState>
    </div>

    <Teleport to="body">
      <Transition name="mr-round-pop">
        <div v-if="showRoundPopup && multiGameStore.roundResult" class="mr-round-popup" @click="showRoundPopup = false; multiGameStore.roundResult = null">
          <div class="mr-round-popup-card" @click.stop>
            <div class="mr-round-popup-icon">
              <Icon
                :icon="multiGameStore.roundResult.roundWinner === (multiGameStore.roomState?.players.findIndex(p => p.isMe) ?? -1) ? 'ph:crown-duotone' : multiGameStore.roundResult.roundWinner === null ? 'ph:handshake-duotone' : 'ph:target-duotone'"
              />
            </div>
            <p class="mr-round-popup-title">
              {{ multiGameStore.roundResult.iWon === null ? t('multi.roundDraw') : multiGameStore.roundResult.iWon ? t('multi.roundWin') : t('multi.roundLose') }}
            </p>
            <p class="mr-round-popup-score">{{ t("multi.roundScore", { my: multiGameStore.roundResult.myWins, opp: multiGameStore.roundResult.opponentWins }) }}</p>
            <p v-if="multiGameStore.roundResult.answerText" class="mr-round-popup-answer">
              <span class="mr-round-popup-answer-label">{{ t("single.correctAnswer") }}</span>
              <span class="mr-round-popup-answer-value">{{ multiGameStore.roundResult.answerText }}</span>
            </p>
            <p class="mr-round-popup-hint">{{ t("multi.popupCloseHint") }}</p>
          </div>
        </div>
      </Transition>
    </Teleport>

    <ModalOverlay v-if="showMatchResult" panel-class="mr-result-modal" max-width="1100px" no-close @close="closeMatchResult">
      <div class="mr-result-header">
        <Icon
          :icon="isWinLike ? 'ph:crown-fill' : isDraw ? 'ph:handshake-duotone' : 'ph:hand-waving-duotone'"
          class="mr-result-icon"
          :class="{ 'mr-result-icon--win': isWinLike }"
        />
        <h2 class="mr-result-title" :class="{ 'mr-result-title--win': isWinLike }">{{ matchResultText }}</h2>
        <p v-if="matchScoreText" class="mr-result-score">{{ matchScoreText }}</p>
        <div v-if="answerText" class="mr-result-answer">
          <span class="mr-result-answer-label">{{ t("single.correctAnswer") }}</span>
          <span class="mr-result-answer-value">{{ answerText }}</span>
        </div>
      </div>
      <div class="mr-result-actions">
        <button
          class="btn btn-submit mr-result-continue"
          :disabled="rematchPending"
          @click="handleContinueGame"
        >
          <Icon
            :icon="rematchPending ? 'ph:hourglass-medium' : 'ph:play-duotone'"
            class="btn-icon"
            :class="{ 'mr-icon-spin': rematchPending }"
            aria-hidden="true"
          />
          {{ rematchPending ? t("multi.waitingAgreement") : t("multi.continueGame") }}
        </button>
        <button class="btn-ghost" @click="openFullResultPage">{{ t("multi.viewFullMatch") }}</button>
        <button class="btn-ghost btn-ghost--danger" @click="closeMatchResult(); leaveRoom();">{{ t("multi.exitRoom") }}</button>
      </div>
    </ModalOverlay>
  </div>
</template>

