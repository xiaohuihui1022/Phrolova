<script setup lang="ts">
import { computed, reactive, shallowRef } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";

import GlassHeader from "@/components/shared/GlassHeader.vue";
import StatusBanner from "@/components/shared/StatusBanner.vue";
import { useAuthStore } from "@/stores/auth";
import { useMultiGameStore } from "@/stores/multiGame";
import { errMsg } from "@/api/client";

const authStore = useAuthStore();
const multiGameStore = useMultiGameStore();
const router = useRouter();
const { t } = useI18n();

const localError = shallowRef("");
const form = reactive({ newPlayerId: "" });

if (!authStore.isAuthenticated) {
  router.replace("/");
}

const winRate = computed(() => {
  if (!authStore.stats.matches) return null;
  return Math.round((authStore.stats.wins / authStore.stats.matches) * 100);
});

const initials = computed(() => authStore.playerId?.charAt(0)?.toUpperCase() ?? "?");

async function savePlayerId() {
  localError.value = "";
  try {
    await authStore.updatePlayerId(form.newPlayerId.trim());
    form.newPlayerId = "";
  } catch (reason) {
    localError.value = errMsg(reason) || t("auth.updateIdFailed");
  }
}

function logout() {
  multiGameStore.disconnect();
  authStore.logout();
  router.push("/");
}
</script>

<template>
  <div class="ap-root" v-if="authStore.isAuthenticated">
    <div class="ap-shell">
      <GlassHeader kicker="Account" :title="t('auth.accountCenter')" back-to="/" />

      <StatusBanner v-if="localError || authStore.error" :message="localError || authStore.error" tone="error" />

      <div class="ap-grid">
        <!-- 左侧：个人信息 + 统计 -->
        <section class="ap-profile">
          <div class="ap-profile-head">
            <div class="ap-avatar">{{ initials }}</div>
            <div class="ap-profile-info">
              <strong class="ap-player-name">{{ authStore.playerId }}<template v-if="authStore.dbId != null"> #{{ authStore.dbId }}</template></strong>
              <span class="ap-player-role">Player</span>
            </div>
          </div>

          <div class="ap-stats">
            <div class="ap-stat">
              <Icon icon="ph:coin-duotone" class="ap-stat-icon" />
              <span class="ap-stat-value">{{ authStore.stats.score }}</span>
              <span class="ap-stat-label">{{ t("auth.totalScore") }}</span>
            </div>
            <div class="ap-stat ap-stat--accent">
              <Icon icon="ph:trophy-duotone" class="ap-stat-icon" />
              <span class="ap-stat-value">{{ winRate !== null ? winRate + "%" : "-" }}</span>
              <span class="ap-stat-label">{{ t("auth.winRate") }}</span>
            </div>
            <div class="ap-stat">
              <Icon icon="ph:crown-duotone" class="ap-stat-icon" />
              <span class="ap-stat-value">{{ authStore.stats.wins }}</span>
              <span class="ap-stat-label">{{ t("auth.wins") }}</span>
            </div>
            <div class="ap-stat">
              <Icon icon="ph:game-controller-duotone" class="ap-stat-icon" />
              <span class="ap-stat-value">{{ authStore.stats.matches }}</span>
              <span class="ap-stat-label">{{ t("auth.matches") }}</span>
            </div>
          </div>

          <div class="ap-sub-stats">
            <div class="ap-sub-stat">
              <span class="ap-sub-stat-label">{{ t("auth.singleResonatorScore") }}</span>
              <span class="ap-sub-stat-value">{{ authStore.stats.single_resonator_score }}</span>
            </div>
            <div class="ap-sub-stat">
              <span class="ap-sub-stat-label">{{ t("auth.singleSkeletonScore") }}</span>
              <span class="ap-sub-stat-value">{{ authStore.stats.single_skeleton_score }}</span>
            </div>
          </div>
        </section>

        <!-- 右侧：操作区 -->
        <section class="ap-actions">
          <div class="ap-card">
            <h3 class="ap-card-title">
              <Icon icon="ph:pencil-duotone" class="ap-card-icon" /> {{ t("auth.modifyIdTitle") }}
            </h3>
            <p class="ap-card-desc">{{ t("auth.modifyIdDesc") }}</p>
            <div class="ap-id-row">
              <input v-model="form.newPlayerId" class="form-input" type="text" :placeholder="t('auth.modifyIdPlaceholder')" />
              <button class="btn" type="button" :disabled="!form.newPlayerId.trim()" @click="savePlayerId">{{ t("common.save") }}</button>
            </div>
          </div>

          <div class="ap-card ap-card--danger">
            <h3 class="ap-card-title">
              <Icon icon="ph:warning-duotone" class="ap-card-icon" /> {{ t("auth.logoutTitle") }}
            </h3>
            <p class="ap-card-desc">{{ t("auth.logoutDesc") }}</p>
            <button class="btn-ghost" type="button" @click="logout">{{ t("auth.logout") }}</button>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
