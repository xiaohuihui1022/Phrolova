<script setup lang="ts">
import { useI18n } from "vue-i18n";
const { t } = useI18n();
</script>

<template>
  <div class="legend-grid">
    <div class="legend-chip">
      <span class="legend-swatch legend-swatch-match"></span>
      <span>{{ t("column.feedbackMatch") }}</span>
    </div>
    <div class="legend-chip">
      <span class="legend-swatch legend-swatch-near"></span>
      <span>{{ t("column.feedbackNear") }}</span>
    </div>
    <div class="legend-chip">
      <span class="legend-swatch legend-swatch-different"></span>
      <span>{{ t("column.feedbackDiff") }}</span>
    </div>
    <div class="legend-chip">
      <span class="legend-swatch legend-swatch-partial"></span>
      <span>{{ t("column.feedbackPartial") }}</span>
    </div>
  </div>
</template>

