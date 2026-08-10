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
      <template v-if="tab.icon">
        <Icon :icon="tab.icon" class="tab-group-icon" aria-hidden="true" />
        <span v-if="tab.iconSecondary" class="tab-group-icon-sep">/</span>
        <Icon v-if="tab.iconSecondary" :icon="tab.iconSecondary" class="tab-group-icon" aria-hidden="true" />
      </template>
      {{ tab.label }}
    </button>
  </nav>
</template>
