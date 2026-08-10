<script setup lang="ts">
import { computed, reactive, shallowRef } from "vue";
import { useRouter } from "vue-router";

import GlassHeader from "@/components/shared/GlassHeader.vue";
import StatusBanner from "@/components/shared/StatusBanner.vue";
import { useAuthStore } from "@/stores/auth";
import { useMultiGameStore } from "@/stores/multiGame";
import { errMsg } from "@/api/client";

const authStore = useAuthStore();
const multiGameStore = useMultiGameStore();
const router = useRouter();

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
    localError.value = errMsg(reason) || "修改 ID 失败";
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
      <GlassHeader kicker="Account" title="账号中心" back-to="/" />

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
              <span class="ap-stat-label">总积分</span>
            </div>
            <div class="ap-stat ap-stat--accent">
              <Icon icon="ph:trophy-duotone" class="ap-stat-icon" />
              <span class="ap-stat-value">{{ winRate !== null ? winRate + '%' : '-' }}</span>
              <span class="ap-stat-label">胜率</span>
            </div>
            <div class="ap-stat">
              <Icon icon="ph:crown-duotone" class="ap-stat-icon" />
              <span class="ap-stat-value">{{ authStore.stats.wins }}</span>
              <span class="ap-stat-label">胜场</span>
            </div>
            <div class="ap-stat">
              <Icon icon="ph:game-controller-duotone" class="ap-stat-icon" />
              <span class="ap-stat-value">{{ authStore.stats.matches }}</span>
              <span class="ap-stat-label">总场次</span>
            </div>
          </div>

          <div class="ap-sub-stats">
            <div class="ap-sub-stat">
              <span class="ap-sub-stat-label">单人 · 共鸣者积分</span>
              <span class="ap-sub-stat-value">{{ authStore.stats.single_resonator_score }}</span>
            </div>
            <div class="ap-sub-stat">
              <span class="ap-sub-stat-label">单人 · 声骸积分</span>
              <span class="ap-sub-stat-value">{{ authStore.stats.single_skeleton_score }}</span>
            </div>
          </div>
        </section>

        <!-- 右侧：操作区 -->
        <section class="ap-actions">
          <div class="ap-card">
            <h3 class="ap-card-title">
              <Icon icon="ph:pencil-duotone" class="ap-card-icon" /> 修改玩家 ID
            </h3>
            <p class="ap-card-desc">修改后前台评分板与排行将同步为新 ID</p>
            <div class="ap-id-row">
              <input v-model="form.newPlayerId" class="form-input" type="text" placeholder="输入新的玩家 ID" />
              <button class="btn" type="button" :disabled="!form.newPlayerId.trim()" @click="savePlayerId">保存</button>
            </div>
          </div>

          <div class="ap-card ap-card--danger">
            <h3 class="ap-card-title">
              <Icon icon="ph:warning-duotone" class="ap-card-icon" /> 退出账号
            </h3>
            <p class="ap-card-desc">退出后返回首页，多人房间将断开连接</p>
            <button class="btn-ghost" type="button" @click="logout">退出登录</button>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
