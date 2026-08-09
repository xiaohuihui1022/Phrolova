<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(defineProps<{
  current: number;
  total: number;
  size?: number;
}>(), { size: 20 });

const emit = defineEmits<{ change: [page: number] }>();

const totalPages = computed(() => Math.max(1, Math.ceil(props.total / props.size)));

const pages = computed(() => {
  const p: (number | "...")[] = [];
  const t = totalPages.value;
  const c = props.current;
  if (t <= 7) {
    for (let i = 1; i <= t; i++) p.push(i);
  } else {
    p.push(1);
    if (c > 3) p.push("...");
    for (let i = Math.max(2, c - 1); i <= Math.min(t - 1, c + 1); i++) p.push(i);
    if (c < t - 2) p.push("...");
    p.push(t);
  }
  return p;
});

const showPrev = computed(() => props.current > 1);
const showNext = computed(() => props.current < totalPages.value);
</script>

<template>
  <nav v-if="totalPages > 1" class="pgn-shell">
    <button class="pgn-btn" :disabled="!showPrev" @click="emit('change', current - 1)">
      <Icon icon="ph:caret-left-duotone" />
    </button>
    <template v-for="p in pages" :key="p">
      <span v-if="p === '...'" class="pgn-ellipsis">…</span>
      <button v-else class="pgn-btn" :class="{ 'pgn-btn--active': p === current }" @click="emit('change', p as number)">
        {{ p }}
      </button>
    </template>
    <button class="pgn-btn" :disabled="!showNext" @click="emit('change', current + 1)">
      <Icon icon="ph:caret-right-duotone" />
    </button>
  </nav>
</template>
