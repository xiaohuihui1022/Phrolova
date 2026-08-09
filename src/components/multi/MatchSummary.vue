<script setup lang="ts">
import { computed } from "vue";

import type { MultiplayerRoomState } from "@/types/game";

const props = defineProps<{
  roomState: MultiplayerRoomState;
}>();

const roundLabel = computed(() => {
  if (props.roomState.roomStatus === "countdown") {
    return `匹配成功，${props.roomState.countdownLeft} 秒后开局`;
  }
  if (props.roomState.roomStatus === "finished") {
    return "整场已结束";
  }
  return `第 ${props.roomState.round} 局 / BO${props.roomState.bestOf}`;
});

const modeLabel = computed(() => {
  const type = props.roomState.quizType === "skeleton" ? "声骸" : "共鸣者";
  const diff = props.roomState.quizType === "skeleton"
    ? (props.roomState.difficulty === "easy" ? "简单" : "困难")
    : "标准";
  return `${type} / ${diff}`;
});

const timeLabel = computed(() => `${props.roomState.timeLeft || props.roomState.countdownLeft || 0} 秒`);
</script>

<template>
  <section class="summary-band">
    <div class="summary-item">
      <span class="summary-label">房间号</span>
      <strong class="summary-value">{{ roomState.roomCode }}</strong>
    </div>
    <span class="summary-sep" />
    <div class="summary-item">
      <span class="summary-label">模式</span>
      <strong class="summary-value">{{ modeLabel }}</strong>
    </div>
    <span class="summary-sep" />
    <div class="summary-item">
      <span class="summary-label">状态</span>
      <strong class="summary-value">{{ roundLabel }}</strong>
    </div>
    <span class="summary-sep" />
    <div class="summary-item">
      <span class="summary-label">剩余时间</span>
      <strong class="summary-value">{{ timeLabel }}</strong>
    </div>
  </section>
</template>

