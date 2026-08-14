<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

import type { MultiplayerRoomState } from "@/types/game";

const { t } = useI18n();

const props = defineProps<{
  roomState: MultiplayerRoomState;
}>();

const roundLabel = computed(() => {
  if (props.roomState.roomStatus === "countdown") {
    return t("multi.matchCountdown", { seconds: props.roomState.countdownLeft });
  }
  if (props.roomState.roomStatus === "finished") {
    return t("multi.matchFinished");
  }
  return t("multi.roundOf", { round: props.roomState.round, bestOf: props.roomState.bestOf });
});

const modeLabel = computed(() => {
  const type = props.roomState.quizType === "skeleton" ? t("multi.typeSkeleton") : t("multi.typeResonator");
  const diff = props.roomState.quizType === "skeleton"
    ? (props.roomState.difficulty === "easy" ? t("multi.diffEasy") : t("multi.diffHard"))
    : t("multi.diffStandard");
  return `${type} / ${diff}`;
});

const timeLabel = computed(() => t("multi.timeSeconds", { seconds: props.roomState.timeLeft || props.roomState.countdownLeft || 0 }));
</script>

<template>
  <section class="summary-band">
    <div class="summary-item">
      <span class="summary-label">{{ t("multi.roomCode") }}</span>
      <strong class="summary-value">{{ roomState.roomCode }}</strong>
    </div>
    <span class="summary-sep" />
    <div class="summary-item">
      <span class="summary-label">{{ t("multi.modeLabel") }}</span>
      <strong class="summary-value">{{ modeLabel }}</strong>
    </div>
    <span class="summary-sep" />
    <div class="summary-item">
      <span class="summary-label">{{ t("multi.statusLabel") }}</span>
      <strong class="summary-value">{{ roundLabel }}</strong>
    </div>
    <span class="summary-sep" />
    <div class="summary-item">
      <span class="summary-label">{{ t("multi.timeRemaining") }}</span>
      <strong class="summary-value">{{ timeLabel }}</strong>
    </div>
  </section>
</template>

