<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { Icon } from "@iconify/vue";
import GuessTable from "@/components/game/GuessTable.vue";
import { readLocalStorage, removeLocalStorage } from "@/composables/useStorage";
import type { MultiplayerRoomState } from "@/types";
import { useMultiGameStore } from "@/stores/multiGame";

type MatchOutcome = "unknown" | "lostByForfeit" | "winByForfeit" | "draw" | "victory" | "defeat";

const router = useRouter();
const { t } = useI18n();
const roomState = ref<MultiplayerRoomState | null>(null);
const matchDelta = ref(0);
const myPlayerId = ref("");

onMounted(() => {
  const data = readLocalStorage<{ roomState: MultiplayerRoomState; scoreDelta: number; myPlayerId: string } | null>("phrolova_match_result", null);
  if (!data) {
    router.replace({ name: "multi-lobby" });
    return;
  }
  roomState.value = data.roomState;
  matchDelta.value = data.scoreDelta ?? 0;
  myPlayerId.value = data.myPlayerId ?? "";
});

const matchOutcome = computed<MatchOutcome>(() => {
  const rs = roomState.value;
  if (!rs) return "unknown";

  // 弃权场景优先判断
  const forfeitBy = rs.forfeitBy;
  if (forfeitBy) {
    return forfeitBy === myPlayerId.value ? "lostByForfeit" : "winByForfeit";
  }

  // 基于 overallWinner 判定
  if (rs.overallWinner === null || rs.overallWinner === undefined) {
    return "draw";
  }
  // 在房间里 players 数组中找我的索引
  const myIdx = rs.players.findIndex(p => p.playerId === myPlayerId.value);
  return rs.overallWinner === myIdx ? "victory" : "defeat";
});

const matchResultText = computed(() => t(`multi.${matchOutcome.value}`));

const isWinLike = computed(() => matchOutcome.value === "victory" || matchOutcome.value === "winByForfeit");
const isDraw = computed(() => matchOutcome.value === "draw");

const matchScoreText = computed(() => {
  if (!matchDelta.value) return "";
  return matchDelta.value > 0 ? t("multi.scorePlus", { n: matchDelta.value }) : t("multi.scoreMinus", { n: matchDelta.value });
});

const resultIcon = computed(() => {
  if (isWinLike.value) return "ph:crown-fill";
  if (isDraw.value) return "ph:handshake-duotone";
  return "ph:hand-waving-duotone";
});

function leaveRoom() {
  removeLocalStorage("phrolova_match_result");
  // 如果还在房间中，发送退出房间消息
  const multiGameStore = useMultiGameStore();
  multiGameStore.leaveRoom().catch(() => undefined);
  router.push({ name: "multi-lobby" });
}

/** 返回房间页：若房间状态仍在则直接回到房间，否则回大厅 */
function backToRoom() {
  const multiGameStore = useMultiGameStore();
  if (multiGameStore.roomState) {
    router.push({ name: "multi-room" });
  } else {
    // 房间已失效（被销毁或已退出），清理并回大厅
    removeLocalStorage("phrolova_match_result");
    router.push({ name: "multi-lobby" });
  }
}
</script>

<template>
  <div class="mrp-screen" v-if="roomState">
    <header class="mrp-header">
      <Icon :icon="resultIcon" class="mrp-header-icon" :class="{ 'mrp-header-icon--win': isWinLike }" />
      <h1 class="mrp-title" :class="{ 'mrp-title--win': isWinLike }">{{ matchResultText }}</h1>
      <p v-if="matchScoreText" class="mrp-score">{{ matchScoreText }}</p>
      <p class="mrp-sub">{{ t("multi.roundNMode", { round: roomState.round, mode: roomState.quizType === "skeleton" ? t("multi.modeSkeleton") : t("multi.modeResonator") }) }}</p>
      <div class="mrp-back-row">
        <button class="mrp-back" @click="backToRoom">
          <Icon icon="ph:door-duotone" class="mrp-back-icon" aria-hidden="true" />
          {{ t("multi.backToRoom") }}
        </button>
        <button class="mrp-back mrp-back--danger" @click="leaveRoom">{{ t("multi.exitRoom") }}</button>
      </div>
    </header>

    <main class="mrp-body">
      <section v-for="entry in roomState.roundHistory" :key="entry.round" class="mrp-round">
        <div class="mrp-round-head">
          <h2 class="mrp-round-label">{{ t("multi.roundN", { round: entry.round }) }}</h2>
          <p v-if="entry.target && (entry.target as any).name" class="mrp-round-answer">
            <span class="mrp-round-answer-label">{{ t("single.correctAnswer") }}</span>
            <span class="mrp-round-answer-value">{{ (entry.target as any).name }}</span>
          </p>
        </div>
        <div class="mrp-round-boards">
          <div v-for="(p, pi) in entry.players" :key="pi" class="mrp-board" :class="p.player_id === myPlayerId ? 'mrp-board-mine' : 'mrp-board-opponent'">
            <h3 class="mrp-board-title">
              <Icon :icon="p.player_id === myPlayerId ? 'ph:user-duotone' : 'ph:users-duotone'" :class="p.player_id === myPlayerId ? 'mrp-board-icon--mine' : 'mrp-board-icon--opponent'" />
              {{ p.player_id === myPlayerId ? t("multi.myGuesses") : t("multi.opponentGuesses") }} <span class="mrp-player-id">({{ p.player_id }}{{ p.db_id != null ? ` #${p.db_id}` : '' }})</span>
            </h3>
            <GuessTable :quiz-type="roomState.quizType" :rows="(p.guesses as any) ?? []" empty-label="-" :target-version="entry.target ? ('version' in entry.target ? Number((entry.target as any).version) : null) : roomState.targetVersion" :target-cost="entry.target ? ('cost' in entry.target ? Number((entry.target as any).cost) : null) : roomState.targetCost" force-reveal />
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

