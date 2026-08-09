<script setup lang="ts">
import { computed } from "vue";

import LoreBadge from "@/components/shared/LoreBadge.vue";
import type { CellStatus, CompareStatus, GuessHistoryRow, QuizType, ResonatorCompare, SkeletonCompare } from "@/types/game";
import { formatGuessValue, getCharacterAvatar, getColumns, getSkeletonAvatar, getStatusClass, getRowValue, renderGroupItem } from "@/utils/game";
import { resolveBadgeCategory } from "@/utils/presentation";
import { useSettings } from "@/composables/useSettings";

const { settings } = useSettings();

const props = defineProps<{
  quizType: QuizType;
  rows: GuessHistoryRow[];
  emptyLabel: string;
  targetVersion?: number | null;
  targetCost?: number | null;
  hiddenKeys?: string[];
  /** 强制展示所有条目（不根据 revealed 遮罩，用于对局回放）。 */
  forceReveal?: boolean;
}>();

const columns = computed(() =>
  getColumns(props.quizType).filter((c) => !props.hiddenKeys?.includes(c.key)),
);

function isRevealed(row: GuessHistoryRow): boolean {
  return props.forceReveal ? true : Boolean(row.revealed);
}

function getCompareCell(compare: ResonatorCompare | SkeletonCompare, key: string) {
  return (compare as unknown as Record<string, unknown>)[key];
}

function isGroupedCompare(value: unknown): value is { cell: CellStatus; items: Array<Record<string, unknown>> } {
  return typeof value === "object" && value !== null && "items" in value && "cell" in value;
}

function getCellClass(row: GuessHistoryRow, key: string) {
  if (key === "name") {
    return "";
  }
  const value = getCompareCell(row.compare, key);
  if (isGroupedCompare(value)) {
    return getStatusClass(value.cell);
  }
  return getStatusClass(value as CompareStatus);
}

function getGroupItems(row: GuessHistoryRow, key: string) {
  const value = getCompareCell(row.compare, key);
  return isGroupedCompare(value) ? value.items : [];
}

function isGroupField(row: GuessHistoryRow, key: string) {
  return isGroupedCompare(getCompareCell(row.compare, key));
}

function getItemStatus(item: Record<string, unknown>) {
  return (item.status as CompareStatus) || "different";
}

function shouldRenderBadge(key: string) {
  return ["attribute", "birthplace", "weapon", "set_name"].includes(key);
}

function formatCellValue(row: GuessHistoryRow, key: string) {
  return formatGuessValue(row.guess, key, {
    targetVersion: props.targetVersion ?? null,
    targetCost: props.targetCost ?? null,
  });
}
</script>

<template>
  <div class="guess-table-shell">
    <table class="guess-table" :class="{ 'guess-table--animated': settings.animations }">
      <thead>
        <tr>
          <th class="guess-table-head">#</th>
          <th class="guess-table-head">头像</th>
          <th v-for="column in columns" :key="column.key" class="guess-table-head">
            {{ column.label }}
          </th>
        </tr>
      </thead>
      <tbody v-if="rows.length">
        <tr v-for="(row, index) in rows" :key="`${index}-${row.guess.name}`"
          :style="settings.animations ? { '--row-index': index } : undefined">
          <td class="guess-table-index">{{ index + 1 }}</td>
          <td class="guess-table-cell guess-table-avatar-cell">
            <img v-if="isRevealed(row)"
              :src="quizType === 'resonator' ? getCharacterAvatar(String(row.guess.name)) : getSkeletonAvatar(String(row.guess.name))"
              class="gt-avatar" alt="" />
          </td>
          <td v-for="column in columns" :key="column.key" class="guess-table-cell"
            :class="getCellClass(row, column.key)">
            <template v-if="column.key === 'name'">
              <div class="gt-name-cell">
                <span class="guess-table-name">{{ isRevealed(row) ? row.guess.name : "***" }}</span>
              </div>
            </template>

            <template v-else-if="isGroupField(row, column.key)">
              <span v-if="!isRevealed(row)" class="guess-table-masked">***</span>
              <div v-else class="compare-token-list">
                <LoreBadge v-for="item in getGroupItems(row, column.key)" :key="String(renderGroupItem(item))"
                  :category="resolveBadgeCategory(column.key, String(renderGroupItem(item)))"
                  :class="getStatusClass(getItemStatus(item))" :label="String(renderGroupItem(item))" compact />
              </div>
            </template>

            <template v-else-if="column.key === 'weapon'">
              <span v-if="isRevealed(row)" class="gt-weapon-text">{{ ('weapon' in row.guess) ? row.guess.weapon : '' }}</span>
              <span v-else class="guess-table-masked">***</span>
            </template>

            <template v-else-if="shouldRenderBadge(column.key)">
              <template v-if="isRevealed(row)">
                <div class="gt-badge-row">
                  <LoreBadge :label="String(formatCellValue(row, column.key))"
                    :category="resolveBadgeCategory(column.key, String(getRowValue(row.guess, column.key)))"
                    compact />
                </div>
              </template>
              <span v-else class="guess-table-masked">***</span>
            </template>

            <template v-else>
              <span v-if="isRevealed(row)" class="guess-table-value" :class="{ 'guess-table-stars': column.key === 'star_rating' }">
                {{ formatCellValue(row, column.key) }}
              </span>
              <span v-else class="guess-table-masked">***</span>
            </template>
          </td>
        </tr>
      </tbody>
    </table>

    <p v-if="!rows.length" class="guess-table-empty">{{ emptyLabel }}</p>
  </div>
</template>

