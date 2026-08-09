<script setup lang="ts">
withDefaults(defineProps<{
  icon?: string;
  kicker?: string;
  title: string;
  description: string;
}>(), {
  icon: "ph:target-duotone",
});
</script>

<template>
  <div class="empty-state">
    <div v-if="icon" class="empty-state-glyph">
      <Icon :icon="icon" aria-hidden="true" />
    </div>
    <p v-if="kicker" class="empty-state-kicker">{{ kicker }}</p>
    <h2 class="empty-state-title">{{ title }}</h2>
    <p class="empty-state-desc">{{ description }}</p>
    <div v-if="$slots.default" class="empty-state-actions">
      <slot />
    </div>
  </div>
</template>

