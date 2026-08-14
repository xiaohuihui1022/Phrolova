<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";

import TabGroup from "@/components/shared/TabGroup.vue";
import type { QuizType, TabOption } from "@/types";
import { useAuthStore } from "@/stores/auth";
import * as api from "@/api";

const PAGE_SIZE = 20;

const authStore = useAuthStore();
const router = useRouter();
const { t } = useI18n();
const loading = shallowRef(false);
const leaderboard = ref<Array<Record<string, unknown>>>([]);
const myInfo = ref<Record<string, unknown> | null>(null);

const page = ref(1);
const total = ref(0);
const totalPages = ref(1);

const mode = ref<"single" | "multi">("multi");
const quizType = ref<QuizType>("resonator");

const leaderTabs = computed<TabOption[]>(() => [
  { key: "multi", label: t("leaderboard.tabMulti") },
  { key: "single-resonator", label: t("leaderboard.tabSingleResonator") },
  { key: "single-skeleton", label: t("leaderboard.tabSingleSkeleton") },
]);

const tabTitle = computed(() => {
  const tab = leaderTabs.value.find(tb => {
    if (tb.key === "multi") return mode.value === "multi";
    if (tb.key === "single-resonator") return mode.value === "single" && quizType.value === "resonator";
    return mode.value === "single" && quizType.value === "skeleton";
  });
  return tab?.label || "";
});

const showPodium = computed(() => page.value === 1);

async function loadLeaderboard() {
  loading.value = true;
  try {
    const data = await api.fetchLeaderboard(
      authStore.playerId || undefined,
      mode.value,
      quizType.value,
      page.value,
      PAGE_SIZE,
    );
    leaderboard.value = data.leaderboard as unknown as Array<Record<string, unknown>>;
    myInfo.value = data.my_info as Record<string, unknown> | null;
    total.value = data.total;
    totalPages.value = data.total_pages;
  } catch { /* silent */ }
  finally { loading.value = false; }
}

function selectTab(key: string) {
  if (key === "multi") { mode.value = "multi"; }
  else if (key === "single-resonator") { mode.value = "single"; quizType.value = "resonator"; }
  else { mode.value = "single"; quizType.value = "skeleton"; }
  page.value = 1;
  loadLeaderboard();
}

function goPage(p: number) {
  if (p < 1 || p > totalPages.value) return;
  page.value = p;
  loadLeaderboard();
}

onMounted(loadLeaderboard);
</script>

<template>
  <div class="lb-page">
    <header class="lb-top">
      <button class="back-btn" @click="router.push('/')">
        <Icon icon="ph:arrow-left-duotone" /> {{ t("leaderboard.back") }}
      </button>
      <div class="lb-header-center">
        <h1 class="lb-title">{{ t("leaderboard.pageTitle") }}</h1>
        <p class="lb-sub">{{ tabTitle }}</p>
      </div>
      <div class="lb-header-right">
        <div v-if="authStore.isAuthenticated" class="lb-me-chip">
          <span class="lb-me-id">{{ authStore.playerId }}<template v-if="authStore.dbId != null"> #{{ authStore.dbId }}</template></span>
          <span v-if="myInfo?.rank" class="lb-me-rank">#{{ myInfo.rank }}</span>
        </div>
      </div>
    </header>

    <TabGroup :tabs="leaderTabs" :active-key="mode === 'multi' ? 'multi' : quizType === 'resonator' ? 'single-resonator' : 'single-skeleton'" @select="selectTab" />

    <div class="lb-main">
      <div class="lb-card">
        <div v-if="loading" class="lb-loading">{{ t("leaderboard.loading") }}</div>

        <template v-else-if="leaderboard.length">
          <div v-if="showPodium" class="lb-podium">
            <div v-for="(row, index) in leaderboard.slice(0, 3)" :key="(row.player_id as string)" class="lb-podium-item" :class="[`lb-podium-item--${index + 1}`]">
              <div class="lb-podium-avatar">
                <Icon v-if="index === 0" icon="ph:crown-fill" class="lb-podium-crown" />
                <span class="lb-podium-rank">{{ index + 1 }}</span>
              </div>
              <span class="lb-podium-name">{{ row.player_id }}<template v-if="row.id != null"> #{{ row.id }}</template></span>
              <span class="lb-podium-score">{{ row.sort_score ?? row.score }}</span>
              <span class="lb-podium-rate">{{ row.win_rate !== null && row.win_rate !== undefined ? row.win_rate + '%' : '-' }}</span>
            </div>
          </div>

          <div class="lb-rows">
            <div v-for="(row, index) in (showPodium ? leaderboard.slice(3) : leaderboard)" :key="(row.player_id as string)" class="lb-row">
              <span class="lb-row-rank">{{ row.rank ?? (showPodium ? index + 4 : (page - 1) * PAGE_SIZE + index + 1) }}</span>
              <span class="lb-row-name">{{ row.player_id }}<template v-if="row.id != null"> #{{ row.id }}</template></span>
              <span class="lb-row-score">{{ row.sort_score ?? row.score }}</span>
              <span class="lb-row-rate">{{ row.win_rate !== null && row.win_rate !== undefined ? row.win_rate + '%' : '-' }}</span>
            </div>
          </div>
        </template>

        <p v-else class="lb-empty">{{ t("leaderboard.empty") }}</p>
      </div>

      <div v-if="totalPages > 1" class="lb-pager">
        <button class="lb-pager-btn" :disabled="page <= 1" @click="goPage(1)">
          <Icon icon="ph:caret-double-left-bold" />
        </button>
        <button class="lb-pager-btn" :disabled="page <= 1" @click="goPage(page - 1)">
          <Icon icon="ph:caret-left-bold" />
        </button>
        <span class="lb-pager-info">{{ page }} / {{ totalPages }}</span>
        <button class="lb-pager-btn" :disabled="page >= totalPages" @click="goPage(page + 1)">
          <Icon icon="ph:caret-right-bold" />
        </button>
        <button class="lb-pager-btn" :disabled="page >= totalPages" @click="goPage(totalPages)">
          <Icon icon="ph:caret-double-right-bold" />
        </button>
      </div>
    </div>
  </div>
</template>

