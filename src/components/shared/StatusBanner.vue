<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  message: string;
  tone?: "info" | "error" | "success";
}>();

const toneClass = computed(() => {
  if (props.tone === "error") return "status-banner-error";
  if (props.tone === "success") return "status-banner-success";
  return "status-banner-info";
});

const toneLabel = computed(() => {
  if (props.tone === "error") return "异常";
  if (props.tone === "success") return "状态";
  return "提示";
});
</script>

<template>
  <p v-if="message" class="status-banner" :class="toneClass">
    <span class="status-banner-mark">{{ toneLabel }}</span>
    <span>{{ message }}</span>
  </p>
</template>

