<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, shallowRef, watch } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";

import GlassHeader from "@/components/shared/GlassHeader.vue";
import ModalOverlay from "@/components/shared/ModalOverlay.vue";
import StatusBanner from "@/components/shared/StatusBanner.vue";
import TabGroup from "@/components/shared/TabGroup.vue";
import EmptyState from "@/components/shared/EmptyState.vue";
import { useAuthStore } from "@/stores/auth";
import { useMultiGameStore } from "@/stores/multiGame";
import type { Difficulty, QuizType, TabOption } from "@/types";
import { errMsg } from "@/api/client";
import { C2S, S2C } from "@/api";
import { getGameSocket, releaseGameSocket, type GameWebSocket } from "@/api/socket";

const authStore = useAuthStore();
const multiGameStore = useMultiGameStore();
const router = useRouter();
const { t } = useI18n();

const config = reactive({
  quizType: "resonator" as QuizType,
  difficulty: "hard" as Difficulty,
  bestOf: 3,
  roomCode: "",
});

const quizTypeTabs = computed<TabOption[]>(() => [
  { key: "resonator", label: t("multi.tabResonator"), icon: "ph:user-duotone" },
  { key: "skeleton", label: t("multi.tabSkeleton"), icon: "ph:ghost-duotone" },
  { key: "global", label: t("multi.tabGlobal"), icon: "ph:user-duotone", iconSecondary: "ph:ghost-duotone" },
]);

const bestOfTabs: TabOption[] = [
  { key: "1", label: "BO1" },
  { key: "3", label: "BO3" },
  { key: "5", label: "BO5" },
];

const difficultyTabs = computed<TabOption[]>(() => [
  { key: "easy", label: t("single.easy") },
  { key: "hard", label: t("single.hard") },
]);

const queueSummary = computed(() => {
  if (config.quizType === "global") {
    return t("multi.queueGlobal");
  }
  if (config.quizType === "skeleton") {
    return t("multi.queueSkeleton", {
      difficulty: config.difficulty === "easy" ? t("single.easy") : t("single.hard"),
      bestOf: config.bestOf,
    });
  }
  return t("multi.queueResonator", { bestOf: config.bestOf });
});

const showRoomActiveModal = shallowRef(false);
const showGlobalCreateErrorModal = shallowRef(false);

function promptStillInRoom() { showRoomActiveModal.value = true; }
function closeRoomActiveModal() { showRoomActiveModal.value = false; }
function goToActiveRoom() { showRoomActiveModal.value = false; router.push("/multi/room"); }
function closeGlobalCreateErrorModal() { showGlobalCreateErrorModal.value = false; }

async function createRoom() {
  if (multiGameStore.roomState) { promptStillInRoom(); return; }
  if (config.quizType === "global") { showGlobalCreateErrorModal.value = true; return; }
  // 共鸣者模式没有难度区分，统一强制为 'easy'，避免匹配时 difficulty 不同导致无法匹配
  const effectiveDifficulty = config.quizType === "skeleton" ? config.difficulty : "easy";
  try { await multiGameStore.createRoom(config.quizType, config.bestOf, effectiveDifficulty); }
  catch (reason) { multiGameStore.error = errMsg(reason) || t("multi.createFailed"); }
}

async function joinRoom() {
  if (!config.roomCode.trim()) return;
  if (multiGameStore.roomState) { promptStillInRoom(); return; }
  try { await multiGameStore.joinRoom(config.roomCode.trim().toUpperCase()); }
  catch (reason) { multiGameStore.error = errMsg(reason) || t("multi.joinFailed"); }
}

async function randomMatch() {
  if (multiGameStore.roomState) { promptStillInRoom(); return; }
  // 共鸣者和全局模式没有难度区分，统一强制为 'easy'
  const effectiveDifficulty = config.quizType === "skeleton" ? config.difficulty : "easy";
  // 按游戏规则文档：随机匹配固定 BO3 赛制
  try { await multiGameStore.joinQueue(config.quizType, effectiveDifficulty, 3); }
  catch (reason) { multiGameStore.error = errMsg(reason) || t("multi.joinQueueFailed"); }
}

watch(() => multiGameStore.roomState?.roomCode, (roomCode) => {
  if (roomCode) router.push("/multi/room");
});

// ── 匹配池实时在线人数（WebSocket 推送） ──
// 通过 /ws/pool 连接到 MatchmakerObject 作为观察者，服务端在匹配池人数变化时主动推送
const poolStats = ref<{ waiting: number; in_match: number; total: number } | null>(null);
const POOL_WS_PATH = "/ws/pool";
let poolWs: GameWebSocket | null = null;
let poolWsRefHeld = false;

async function subscribePoolStats() {
  if (poolWsRefHeld) return;
  if (!authStore.isAuthenticated || multiGameStore.inQueue || multiGameStore.roomState) return;
  try {
    poolWs = await getGameSocket(POOL_WS_PATH, {
      onMessage: (msg) => {
        if (msg.type === S2C.POOL_STATS) {
          poolStats.value = {
            waiting: (msg.payload.waiting as number) ?? 0,
            in_match: (msg.payload.in_match as number) ?? 0,
            total: (msg.payload.total as number) ?? 0,
          };
        }
      },
      onOpen: () => {
        // 重连后重新订阅，触发服务端推送当前统计
        poolWs?.send(C2S.POOL_STATS_SUBSCRIBE);
      },
    });
    poolWsRefHeld = true;
    // 首次连接后也发送订阅（服务端在 accept 时已推送一次，这里作为兜底）
    poolWs.send(C2S.POOL_STATS_SUBSCRIBE);
  } catch {
    // 静默失败，不影响用户使用
  }
}

function unsubscribePoolStats() {
  if (poolWsRefHeld) {
    releaseGameSocket(POOL_WS_PATH);
    poolWsRefHeld = false;
    poolWs = null;
  }
}

// 进入队列或房间时断开观察者连接；回到大厅时重新订阅
watch(() => multiGameStore.inQueue, (inQueue) => {
  if (inQueue) unsubscribePoolStats();
  else subscribePoolStats();
});
watch(() => multiGameStore.roomState, (roomState) => {
  if (roomState) unsubscribePoolStats();
  else subscribePoolStats();
});

onMounted(async () => {
  if (authStore.isAuthenticated) {
    await multiGameStore.resumeRoom().catch(() => undefined);
    if (!multiGameStore.inQueue && !multiGameStore.roomState) {
      subscribePoolStats();
    }
  }
});

onUnmounted(() => {
  unsubscribePoolStats();
});
</script>

<template>
  <div class="ml-screen">
    <div class="ml-shell">
      <GlassHeader class="ml-glass-header" :kicker="t('multi.lobbyKicker')" title="Multiplayer Lobby" back-to="/" />

      <div v-if="!multiGameStore.inQueue" class="ml-config">
        <TabGroup :tabs="quizTypeTabs" :active-key="config.quizType" @select="config.quizType = $event as QuizType" />
        <TabGroup v-if="config.quizType !== 'global'" :tabs="bestOfTabs" :active-key="String(config.bestOf)" @select="config.bestOf = Number($event)" />
        <TabGroup v-if="config.quizType === 'skeleton'" :tabs="difficultyTabs" :active-key="config.difficulty"
          @select="config.difficulty = $event as Difficulty" />
        <span class="ml-config-summary">{{ queueSummary }}</span>
      </div>

      <div class="status-stack">
        <StatusBanner v-if="!authStore.isAuthenticated" :message="t('multi.loginRequired')" tone="error" />
        <StatusBanner v-else-if="multiGameStore.error" :message="multiGameStore.error" tone="error" />
      </div>

      <!-- 匹配中 -->
      <div v-if="authStore.isAuthenticated && multiGameStore.inQueue" class="ml-match" key="match">
        <div class="ml-match-orb" aria-hidden="true"></div>
        <div class="ml-match-spinner">
          <div v-for="i in 3" :key="i" class="ml-match-ring" :style="{ animationDelay: `${(i - 1) * 0.25}s` }"></div>
          <div class="ml-match-core">
            <Icon icon="ph:shuffle-duotone" aria-hidden="true" />
          </div>
        </div>
        <div class="ml-match-info">
          <h2 class="ml-match-title">{{ t("multi.matching") }}</h2>
          <p class="ml-match-desc">{{ t("multi.searchingForOpponent") }}</p>
          <span class="ml-match-chip">{{ queueSummary }}</span>
        </div>
        <button class="btn" style="margin-top:0.5rem" @click="multiGameStore.cancelQueue()">
          <Icon icon="ph:x-circle-duotone" class="btn-icon" aria-hidden="true" /> {{ t("multi.cancelMatch") }}
        </button>
      </div>

      <!-- 房间面板 -->
      <div v-else-if="authStore.isAuthenticated" class="ml-grid">
        <article class="ml-card">
          <div class="ml-card-icon">
            <Icon icon="ph:plus-circle-duotone" aria-hidden="true" />
          </div>
          <div class="ml-card-copy">
            <p class="ml-card-kicker">CREATE ROOM</p>
            <h2 class="ml-card-title">{{ t("multi.createRoom") }}</h2>
            <p class="ml-card-desc">{{ t("multi.createRoomDesc") }}</p>
          </div>
          <button class="btn" style="margin-top:auto" @click="createRoom">
            <Icon icon="ph:plus-duotone" class="btn-icon" aria-hidden="true" /> {{ t("multi.createRoom") }}
          </button>
        </article>

        <article class="ml-card">
          <div class="ml-card-icon">
            <Icon icon="ph:shuffle-duotone" aria-hidden="true" />
          </div>
          <div class="ml-card-copy">
            <p class="ml-card-kicker">RANDOM MATCH</p>
            <h2 class="ml-card-title">
              {{ t("multi.randomMatch") }}
              <span v-if="poolStats" class="ml-pool-chip" :title="t('multi.poolChipTitle', { waiting: poolStats.waiting, inMatch: poolStats.in_match })">
                <span class="ml-pool-dot" aria-hidden="true"></span>
                {{ t("multi.poolOnline", { total: poolStats.total }) }}
              </span>
            </h2>
            <p class="ml-card-desc">{{ t("multi.randomMatchDesc") }}</p>
            <p v-if="poolStats" class="ml-pool-detail">
              {{ t("multi.poolDetail", { waiting: poolStats.waiting, inMatch: poolStats.in_match }) }}
            </p>
          </div>
          <div class="ml-btn-row">
            <button class="btn" @click="randomMatch">
              <Icon icon="ph:lightning-duotone" class="btn-icon" aria-hidden="true" /> {{ t("multi.startMatch") }}
            </button>
            <button class="btn-ghost" @click="multiGameStore.cancelQueue()">{{ t("common.cancel") }}</button>
          </div>
        </article>

        <article class="ml-card">
          <div class="ml-card-icon">
            <Icon icon="ph:sign-in-duotone" aria-hidden="true" />
          </div>
          <div class="ml-card-copy">
            <p class="ml-card-kicker">JOIN ROOM</p>
            <h2 class="ml-card-title">{{ t("multi.joinRoom") }}</h2>
            <p class="ml-card-desc">{{ t("multi.joinRoomDesc") }}</p>
          </div>
          <div class="ml-join-row">
            <input v-model="config.roomCode" class="form-input" maxlength="6" :placeholder="t('multi.roomCodePlaceholder')"
              style="text-transform:uppercase;letter-spacing:0.18em;text-align:center" />
            <button class="btn" @click="joinRoom">{{ t("multi.joinBtn") }}</button>
          </div>
        </article>

        <article class="ml-card">
          <div class="ml-card-icon">
            <Icon icon="ph:arrow-u-up-left-duotone" aria-hidden="true" />
          </div>
          <div class="ml-card-copy">
            <p class="ml-card-kicker">RESUME</p>
            <h2 class="ml-card-title">{{ t("multi.resumeRoom") }}</h2>
            <p class="ml-card-desc">{{ t("multi.resumeRoomDesc") }}</p>
          </div>
          <RouterLink class="btn" style="display:inline-flex;text-decoration:none;margin-top:auto" to="/multi/room">
            <Icon icon="ph:arrow-right-duotone" class="btn-icon" aria-hidden="true" /> {{ t("multi.goToRoom") }}
          </RouterLink>
        </article>
      </div>

      <EmptyState v-else icon="ph:lock-duotone" kicker="NOTICE" :title="t('multi.lobbyLoginRequired')" :description="t('multi.lobbyLoginRequiredDesc')">
        <RouterLink class="btn" to="/auth">{{ t("multi.goToLogin") }}</RouterLink>
      </EmptyState>

      <footer v-if="!multiGameStore.inQueue" class="ml-foot">
        <span class="ml-foot-status">
          <span class="ml-foot-dot" :class="{ 'ml-foot-dot--on': authStore.isAuthenticated }"></span>
          {{ authStore.isAuthenticated ? t("multi.loggedInAs", { player: `${authStore.playerId}${authStore.dbId != null ? ` #${authStore.dbId}` : ""}` }) : t("multi.notLoggedIn") }}
        </span>
        <span class="ml-foot-hint">{{ t("multi.selectMode") }}</span>
      </footer>
    </div>

    <ModalOverlay v-if="showRoomActiveModal" panel-class="ml-room-modal" max-width="380px" no-close
      @close="closeRoomActiveModal">
      <div class="ml-room-modal-icon">
        <Icon icon="ph:warning-circle-duotone" aria-hidden="true" />
      </div>
      <p class="ml-room-modal-kicker">NOTICE</p>
      <h2 class="ml-room-modal-title">{{ t("multi.stillInRoom") }}</h2>
      <p class="ml-room-modal-desc">{{ t("multi.stillInRoomDesc", { code: multiGameStore.roomState?.roomCode ?? "" }) }}</p>
      <div class="ml-room-modal-actions">
        <button class="btn" @click="goToActiveRoom">
          <Icon icon="ph:arrow-right-duotone" class="btn-icon" /> {{ t("multi.goToRoom") }}
        </button>
        <button class="btn-ghost" @click="closeRoomActiveModal">{{ t("multi.gotIt") }}</button>
      </div>
    </ModalOverlay>

    <!-- 全局模式不允许创建房间弹窗 -->
    <ModalOverlay v-if="showGlobalCreateErrorModal" panel-class="ml-room-modal" max-width="380px" no-close
      @close="closeGlobalCreateErrorModal">
      <div class="ml-room-modal-icon">
        <Icon icon="ph:warning-circle-duotone" aria-hidden="true" />
      </div>
      <p class="ml-room-modal-kicker">NOTICE</p>
      <h2 class="ml-room-modal-title">{{ t("multi.globalMatchOnly") }}</h2>
      <p class="ml-room-modal-desc">{{ t("multi.globalMatchOnlyDesc") }}</p>
      <div class="ml-room-modal-actions">
        <button class="btn" @click="closeGlobalCreateErrorModal">{{ t("multi.gotIt") }}</button>
      </div>
    </ModalOverlay>

    <!-- 随机匹配成功弹窗：弥补从匹配成功到进入房间期间的视觉空白 -->
    <ModalOverlay v-if="multiGameStore.matched" panel-class="ml-matched-modal" max-width="360px" no-close
      @close="() => { /* 自动关闭，不可手动关闭 */ }">
      <div class="ml-matched-icon">
        <Icon icon="ph:check-circle-duotone" aria-hidden="true" />
      </div>
      <p class="ml-matched-kicker">MATCHED</p>
      <h2 class="ml-matched-title">{{ t("multi.matchedTitle") }}</h2>
      <p class="ml-matched-desc">{{ t("multi.matchedDesc") }}</p>
      <div class="ml-matched-spinner" aria-hidden="true">
        <div v-for="i in 3" :key="i" class="ml-matched-ring" :style="{ animationDelay: `${(i - 1) * 0.2}s` }"></div>
      </div>
    </ModalOverlay>

    <!-- 创建房间弹窗：弥补从点击创建到进入房间页面的延迟 -->
    <ModalOverlay v-if="multiGameStore.creatingRoom" panel-class="ml-creating-modal" max-width="360px" no-close
      @close="() => { /* 自动关闭，不可手动关闭 */ }">
      <div class="ml-creating-icon">
        <Icon icon="ph:sparkle-duotone" aria-hidden="true" />
      </div>
      <p class="ml-creating-kicker">CREATING</p>
      <h2 class="ml-creating-title">{{ t("multi.creatingTitle") }}</h2>
      <p class="ml-creating-desc">{{ t("multi.creatingDesc") }}</p>
      <div class="ml-creating-spinner" aria-hidden="true">
        <div v-for="i in 3" :key="i" class="ml-creating-ring" :style="{ animationDelay: `${(i - 1) * 0.2}s` }"></div>
      </div>
    </ModalOverlay>

    <!-- 加入房间弹窗：弥补从点击加入到进入房间页面的延迟 -->
    <ModalOverlay v-if="multiGameStore.joiningRoom" panel-class="ml-joining-modal" max-width="360px" no-close
      @close="() => { /* 自动关闭，不可手动关闭 */ }">
      <div class="ml-joining-icon">
        <Icon icon="ph:sign-in-duotone" aria-hidden="true" />
      </div>
      <p class="ml-joining-kicker">JOINING</p>
      <h2 class="ml-joining-title">{{ t("multi.joiningTitle") }}</h2>
      <p class="ml-joining-desc">{{ t("multi.joiningDesc") }}</p>
      <div class="ml-joining-spinner" aria-hidden="true">
        <div v-for="i in 3" :key="i" class="ml-joining-ring" :style="{ animationDelay: `${(i - 1) * 0.2}s` }"></div>
      </div>
    </ModalOverlay>
  </div>
</template>
