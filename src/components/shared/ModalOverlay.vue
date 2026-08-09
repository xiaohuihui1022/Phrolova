<script setup lang="ts">
withDefaults(defineProps<{
  maxWidth?: string;
  noClose?: boolean;
  panelClass?: string;
}>(), {
  maxWidth: "400px",
  noClose: false,
});

defineEmits<{
  close: [];
}>();

defineSlots<{
  default(): unknown;
}>();
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="$emit('close')">
      <div class="modal-panel" :class="panelClass" :style="{ maxWidth }">
        <slot />
        <button v-if="!noClose" class="modal-close-btn" type="button" @click="$emit('close')" aria-label="关闭">
          <Icon icon="ph:x-bold" aria-hidden="true" />
        </button>
      </div>
    </div>
  </Teleport>
</template>
