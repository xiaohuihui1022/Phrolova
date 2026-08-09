<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { Icon } from "@iconify/vue";
import GuessTable from "@/components/game/GuessTable.vue";
import { readLocalStorage, removeLocalStorage } from "@/composables/useStorage";
import type { MultiplayerRoomState } from "@/types";
import { useMultiGameStore } from "@/stores/multiGame";

const router = useRouter();
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

const matchResultText = computed(() => {
  const rs = roomState.value;
  if (!rs) return "未知结果";

  // 弃权场景优先判断
  const forfeitBy = rs.forfeitBy;
  if (forfeitBy) {
    if (forfeitBy === myPlayerId.value) {
      return "失败（已弃权）";
    } else {
      return "胜利（对手弃权）";
    }
  }

  // 基于 overallWinner 判定
  if (rs.overallWinner === null || rs.overallWinner === undefined) {
    return "平局";
  }
  // 在房间里 players 数组中找我的索引
  const myIdx = rs.players.findIndex(p => p.playerId === myPlayerId.value);
  return rs.overallWinner === myIdx ? "胜利" : "失败";
});

const matchScoreText = computed(() => {
  if (!matchDelta.value) return "";
  return matchDelta.value > 0 ? `+${matchDelta.value} 分` : `${matchDelta.value} 分`;
});

const resultIcon = computed(() => {
  if (matchResultText.value === "胜利") return "ph:crown-fill";
  if (matchResultText.value === "平局") return "ph:handshake-duotone";
  return "ph:hand-waving-duotone";
});

function leaveRoom() {
  removeLocalStorage("phrolova_match_result");
  // 如果还在房间中，发送退出房间消息
  const multiGameStore = useMultiGameStore();
  multiGameStore.leaveRoom().catch(() => undefined);
  router.push({ name: "multi-lobby" });
}
</script>

<template>
  <div class="mrp-screen" v-if="roomState">
    <header class="mrp-header">
      <Icon :icon="resultIcon" class="mrp-header-icon" :class="{ 'mrp-header-icon--win': matchResultText === '胜利' }" />
      <h1 class="mrp-title" :class="{ 'mrp-title--win': matchResultText === '胜利' }">{{ matchResultText }}</h1>
      <p v-if="matchScoreText" class="mrp-score">{{ matchScoreText }}</p>
      <p class="mrp-sub">第 {{ roomState.round }} 局 · {{ roomState.quizType === "skeleton" ? "声骸" : "共鸣者" }}模式</p>
      <div class="mrp-back-row">
        <button class="mrp-back mrp-back--danger" @click="leaveRoom">退出房间</button>
      </div>
    </header>

    <main class="mrp-body">
      <section v-for="entry in roomState.roundHistory" :key="entry.round" class="mrp-round">
        <div class="mrp-round-head">
          <h2 class="mrp-round-label">第 {{ entry.round }} 局</h2>
          <p v-if="entry.target && (entry.target as any).name" class="mrp-round-answer">
            <span class="mrp-round-answer-label">正确答案</span>
            <span class="mrp-round-answer-value">{{ (entry.target as any).name }}</span>
          </p>
        </div>
        <div class="mrp-round-boards">
          <div v-for="(p, pi) in entry.players" :key="pi" class="mrp-board" :class="p.player_id === myPlayerId ? 'mrp-board-mine' : 'mrp-board-opponent'">
            <h3 class="mrp-board-title">
              <Icon :icon="p.player_id === myPlayerId ? 'ph:user-duotone' : 'ph:users-duotone'" :class="p.player_id === myPlayerId ? 'mrp-board-icon--mine' : 'mrp-board-icon--opponent'" />
              {{ p.player_id === myPlayerId ? '我方猜测' : `对方猜测` }} <span class="mrp-player-id">({{ p.player_id }})</span>
            </h3>
            <GuessTable :quiz-type="roomState.quizType" :rows="(p.guesses as any) ?? []" empty-label="-" :target-version="entry.target ? ('version' in entry.target ? Number((entry.target as any).version) : null) : roomState.targetVersion" :target-cost="entry.target ? ('cost' in entry.target ? Number((entry.target as any).cost) : null) : roomState.targetCost" force-reveal />
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

