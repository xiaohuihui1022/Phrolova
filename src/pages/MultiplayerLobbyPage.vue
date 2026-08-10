<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, shallowRef, watch } from "vue";
import { useRouter } from "vue-router";

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

const config = reactive({
  quizType: "resonator" as QuizType,
  difficulty: "hard" as Difficulty,
  bestOf: 3,
  roomCode: "",
});

const quizTypeTabs: TabOption[] = [
  { key: "resonator", label: "共鸣者", icon: "ph:user-duotone" },
  { key: "skeleton", label: "声骸", icon: "ph:ghost-duotone" },
  { key: "global", label: "全局", icon: "ph:user-duotone", iconSecondary: "ph:ghost-duotone" },
];

const bestOfTabs: TabOption[] = [
  { key: "1", label: "BO1" },
  { key: "3", label: "BO3" },
  { key: "5", label: "BO5" },
];

const difficultyTabs: TabOption[] = [
  { key: "easy", label: "简单" },
  { key: "hard", label: "困难" },
];

const queueSummary = computed(() => {
  if (config.quizType === "global") {
    return "全局匹配";
  }
  if (config.quizType === "skeleton") {
    return `声骸 / ${config.difficulty === "easy" ? "简单" : "困难"} / BO${config.bestOf}`;
  }
  return `共鸣者 / BO${config.bestOf}`;
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
  catch (reason) { multiGameStore.error = errMsg(reason) || "创建房间失败"; }
}

async function joinRoom() {
  if (!config.roomCode.trim()) return;
  if (multiGameStore.roomState) { promptStillInRoom(); return; }
  try { await multiGameStore.joinRoom(config.roomCode.trim().toUpperCase()); }
  catch (reason) { multiGameStore.error = errMsg(reason) || "加入房间失败"; }
}

async function randomMatch() {
  if (multiGameStore.roomState) { promptStillInRoom(); return; }
  // 共鸣者和全局模式没有难度区分，统一强制为 'easy'
  const effectiveDifficulty = config.quizType === "skeleton" ? config.difficulty : "easy";
  // 按游戏规则文档：随机匹配固定 BO3 赛制
  try { await multiGameStore.joinQueue(config.quizType, effectiveDifficulty, 3); }
  catch (reason) { multiGameStore.error = errMsg(reason) || "进入匹配队列失败"; }
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
      <GlassHeader class="ml-glass-header" kicker="多人 · 对战大厅" title="Multiplayer Lobby" back-to="/" />

      <div v-if="!multiGameStore.inQueue" class="ml-config">
        <TabGroup :tabs="quizTypeTabs" :active-key="config.quizType" @select="config.quizType = $event as QuizType" />
        <TabGroup v-if="config.quizType !== 'global'" :tabs="bestOfTabs" :active-key="String(config.bestOf)" @select="config.bestOf = Number($event)" />
        <TabGroup v-if="config.quizType === 'skeleton'" :tabs="difficultyTabs" :active-key="config.difficulty"
          @select="config.difficulty = $event as Difficulty" />
        <span class="ml-config-summary">{{ queueSummary }}</span>
      </div>

      <div class="status-stack">
        <StatusBanner v-if="!authStore.isAuthenticated" message="多人模式需要先登录账号" tone="error" />
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
          <h2 class="ml-match-title">正在匹配</h2>
          <p class="ml-match-desc">Searching for opponent...</p>
          <span class="ml-match-chip">{{ queueSummary }}</span>
        </div>
        <button class="btn" style="margin-top:0.5rem" @click="multiGameStore.cancelQueue()">
          <Icon icon="ph:x-circle-duotone" class="btn-icon" aria-hidden="true" /> 取消匹配
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
            <h2 class="ml-card-title">创建房间</h2>
            <p class="ml-card-desc">自定义题型与赛制，生成房间码邀请对手加入。</p>
          </div>
          <button class="btn" style="margin-top:auto" @click="createRoom">
            <Icon icon="ph:plus-duotone" class="btn-icon" aria-hidden="true" /> 创建房间
          </button>
        </article>

        <article class="ml-card">
          <div class="ml-card-icon">
            <Icon icon="ph:shuffle-duotone" aria-hidden="true" />
          </div>
          <div class="ml-card-copy">
            <p class="ml-card-kicker">RANDOM MATCH</p>
            <h2 class="ml-card-title">
              随机匹配
              <span v-if="poolStats" class="ml-pool-chip" :title="`等待 ${poolStats.waiting} · 对局中 ${poolStats.in_match}`">
                <span class="ml-pool-dot" aria-hidden="true"></span>
                {{ poolStats.total }} 人在线
              </span>
            </h2>
            <p class="ml-card-desc">自动匹配在线玩家，固定 BO3 赛制，匹配成功即进入房间。</p>
            <p v-if="poolStats" class="ml-pool-detail">
              等待 {{ poolStats.waiting }} · 对局中 {{ poolStats.in_match }}
            </p>
          </div>
          <div class="ml-btn-row">
            <button class="btn" @click="randomMatch">
              <Icon icon="ph:lightning-duotone" class="btn-icon" aria-hidden="true" /> 开始匹配
            </button>
            <button class="btn-ghost" @click="multiGameStore.cancelQueue()">取消</button>
          </div>
        </article>

        <article class="ml-card">
          <div class="ml-card-icon">
            <Icon icon="ph:sign-in-duotone" aria-hidden="true" />
          </div>
          <div class="ml-card-copy">
            <p class="ml-card-kicker">JOIN ROOM</p>
            <h2 class="ml-card-title">加入房间</h2>
            <p class="ml-card-desc">输入 6 位房间码，快速加入好友创建的已有房间。</p>
          </div>
          <div class="ml-join-row">
            <input v-model="config.roomCode" class="form-input" maxlength="6" placeholder="输入房间码"
              style="text-transform:uppercase;letter-spacing:0.18em;text-align:center" />
            <button class="btn" @click="joinRoom">加入</button>
          </div>
        </article>

        <article class="ml-card">
          <div class="ml-card-icon">
            <Icon icon="ph:arrow-u-up-left-duotone" aria-hidden="true" />
          </div>
          <div class="ml-card-copy">
            <p class="ml-card-kicker">RESUME</p>
            <h2 class="ml-card-title">恢复房间</h2>
            <p class="ml-card-desc">返回当前进行中的房间继续对战，断线重连保留状态。</p>
          </div>
          <RouterLink class="btn" style="display:inline-flex;text-decoration:none;margin-top:auto" to="/multi/room">
            <Icon icon="ph:arrow-right-duotone" class="btn-icon" aria-hidden="true" /> 前往房间
          </RouterLink>
        </article>
      </div>

      <EmptyState v-else icon="ph:lock-duotone" kicker="NOTICE" title="登录后可进入多人大厅" description="账号体系接入实时房间、积分变动与排行榜同步。">
        <RouterLink class="btn" to="/auth">前往登录</RouterLink>
      </EmptyState>

      <footer v-if="!multiGameStore.inQueue" class="ml-foot">
        <span class="ml-foot-status">
          <span class="ml-foot-dot" :class="{ 'ml-foot-dot--on': authStore.isAuthenticated }"></span>
          {{ authStore.isAuthenticated ? `已登录 · ${authStore.playerId}${authStore.dbId != null ? ` #${authStore.dbId}` : ''}` : "未登录" }}
        </span>
        <span class="ml-foot-hint">选择一个模式开始</span>
      </footer>
    </div>

    <ModalOverlay v-if="showRoomActiveModal" panel-class="ml-room-modal" max-width="380px" no-close
      @close="closeRoomActiveModal">
      <div class="ml-room-modal-icon">
        <Icon icon="ph:warning-circle-duotone" aria-hidden="true" />
      </div>
      <p class="ml-room-modal-kicker">NOTICE</p>
      <h2 class="ml-room-modal-title">你仍然在房间里</h2>
      <p class="ml-room-modal-desc">当前你还在房间 {{ multiGameStore.roomState?.roomCode }} 对局中，请先退出房间后再创建或匹配新的对局。</p>
      <div class="ml-room-modal-actions">
        <button class="btn" @click="goToActiveRoom">
          <Icon icon="ph:arrow-right-duotone" class="btn-icon" /> 前往房间
        </button>
        <button class="btn-ghost" @click="closeRoomActiveModal">知道了</button>
      </div>
    </ModalOverlay>

    <!-- 全局模式不允许创建房间弹窗 -->
    <ModalOverlay v-if="showGlobalCreateErrorModal" panel-class="ml-room-modal" max-width="380px" no-close
      @close="closeGlobalCreateErrorModal">
      <div class="ml-room-modal-icon">
        <Icon icon="ph:warning-circle-duotone" aria-hidden="true" />
      </div>
      <p class="ml-room-modal-kicker">NOTICE</p>
      <h2 class="ml-room-modal-title">全局模式仅限随机匹配</h2>
      <p class="ml-room-modal-desc">全局匹配模式会为你匹配共鸣者或声骸的任意对手，无法创建指定类型的房间。请使用"随机匹配"按钮开始对局。</p>
      <div class="ml-room-modal-actions">
        <button class="btn" @click="closeGlobalCreateErrorModal">知道了</button>
      </div>
    </ModalOverlay>

    <!-- 随机匹配成功弹窗：弥补从匹配成功到进入房间期间的视觉空白 -->
    <ModalOverlay v-if="multiGameStore.matched" panel-class="ml-matched-modal" max-width="360px" no-close
      @close="() => { /* 自动关闭，不可手动关闭 */ }">
      <div class="ml-matched-icon">
        <Icon icon="ph:check-circle-duotone" aria-hidden="true" />
      </div>
      <p class="ml-matched-kicker">MATCHED</p>
      <h2 class="ml-matched-title">匹配成功</h2>
      <p class="ml-matched-desc">已找到对手，正在进入房间...</p>
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
      <h2 class="ml-creating-title">创建成功</h2>
      <p class="ml-creating-desc">房间已创建，正在进入房间...</p>
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
      <h2 class="ml-joining-title">加入成功</h2>
      <p class="ml-joining-desc">已加入房间，正在进入房间...</p>
      <div class="ml-joining-spinner" aria-hidden="true">
        <div v-for="i in 3" :key="i" class="ml-joining-ring" :style="{ animationDelay: `${(i - 1) * 0.2}s` }"></div>
      </div>
    </ModalOverlay>
  </div>
</template>
