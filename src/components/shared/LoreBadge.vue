<script setup lang="ts">
import { computed } from "vue";

import { getBadgeMeta, type BadgeCategory } from "@/utils/presentation";

const props = withDefaults(
  defineProps<{
    label: string;
    category?: BadgeCategory;
    compact?: boolean;
  }>(),
  {
    category: "plain",
    compact: false,
  },
);

const meta = computed(() => getBadgeMeta(props.label, props.category));

const badgeStyle = computed(() => ({
  "--badge-accent": meta.value.accent,
}));

const iconAlt = computed(() => `${props.label} icon`);
</script>

<template>
  <span class="lore-badge" :class="{ 'lore-badge-compact': compact }" :style="badgeStyle">
    <span class="lore-badge-mark">
      <img v-if="meta.iconUrl" :src="meta.iconUrl" :alt="iconAlt" loading="lazy" />
      <span v-else>{{ meta.mark }}</span>
    </span>
    <span class="lore-badge-text">{{ label }}</span>
  </span>
</template>

