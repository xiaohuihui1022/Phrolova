<script setup lang="ts">
import { useRouter } from "vue-router";
import { useTheme } from "@/composables/useTheme";

defineProps<{
  kicker: string;
  title: string;
  backTo: string;
}>();

defineSlots<{
  actions?(): unknown;
}>();

const router = useRouter();
const { theme, toggleTheme } = useTheme();
</script>

<template>
  <header class="glass-header">
    <div class="glass-header-left">
      <button class="glass-header-back" @click="router.push(backTo)" :aria-label="`返回${backTo}`">
        ←
      </button>
      <div class="glass-header-info">
        <span class="glass-header-kicker">{{ kicker }}</span>
        <span class="glass-header-title">{{ title }}</span>
      </div>
    </div>

    <div class="glass-header-actions">
      <slot name="actions" />
      <button class="glass-header-btn glass-header-theme" @click="toggleTheme"
        :title="theme === 'phrolova-light' ? '暗色' : '亮色'">
        {{ theme === 'phrolova-light' ? '暗' : '亮' }}
      </button>
    </div>
  </header>
</template>
