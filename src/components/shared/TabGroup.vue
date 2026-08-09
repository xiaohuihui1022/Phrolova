<script setup lang="ts">
import type { TabOption } from "@/types";

defineProps<{
  tabs: TabOption[];
  activeKey: string;
}>();

defineEmits<{
  select: [key: string];
}>();
</script>

<template>
  <nav class="tab-group">
    <button
      v-for="tab in tabs"
      :key="tab.key"
      class="tab-group-btn"
      :class="{ 'tab-group-btn--active': activeKey === tab.key }"
      @click="$emit('select', tab.key)"
    >
      <Icon v-if="tab.icon" :icon="tab.icon" class="tab-group-icon" aria-hidden="true" />
      {{ tab.label }}
    </button>
  </nav>
</template>

