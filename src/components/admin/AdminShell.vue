<script setup lang="ts">
import { ref } from "vue";
import { useRouter, useRoute } from "vue-router";
import { Icon } from "@iconify/vue";
import { useAdmin, handleAdminApiError } from "@/composables/useAdmin";
import { apiPath, requestJson } from "@/api/http";

const router = useRouter();
const route = useRoute();
const { doLogout, adminHeaders, adminUsername } = useAdmin();

const tabs = [
  { key: "diff", label: "对比同步", icon: "ph:git-diff-duotone", to: "/admin/diff" },
  { key: "table", label: "数据表格", icon: "ph:table-duotone", to: "/admin/table" },
  { key: "ack", label: "致谢名单", icon: "ph:hand-heart-duotone", to: "/admin/acknowledgements" },
];

const logs = ref<Array<{ time: string; level: string; message: string }>>([]);
const showLogs = ref(false);
const logsLoading = ref(false);
const logsError = ref("");

async function loadLogs() {
  logsLoading.value = true;
  logsError.value = "";
  try {
    const d = await requestJson<{ logs: Array<{ time: string; level: string; message: string }> }>(
      apiPath("/admin/logs"),
      { headers: adminHeaders() },
    );
    logs.value = d.logs || [];
  } catch (e) {
    if (!handleAdminApiError(e)) {
      logsError.value = e instanceof Error ? e.message : "日志加载失败";
    }
  } finally {
    logsLoading.value = false;
  }
}

async function toggleLogs() {
  showLogs.value = !showLogs.value;
  if (showLogs.value && logs.value.length === 0) await loadLogs();
}

async function onLogout() {
  await doLogout();
  router.replace({ name: "admin-login" });
}
</script>

<template>
  <div class="ad-page">
    <header class="ad-top">
      <button class="back-btn" @click="router.push('/')"><Icon icon="ph:arrow-left-duotone" /> BACK</button>
      <h1 class="ad-title">管理面板</h1>
      <div class="ad-top-right">
        <span v-if="adminUsername" class="ad-user-chip">
          <Icon icon="ph:user-circle-duotone" /> {{ adminUsername }}
        </span>
        <button class="ad-logout-btn" @click="onLogout">登出</button>
      </div>
    </header>

    <nav class="ad-tabs">
      <router-link
        v-for="t in tabs"
        :key="t.key"
        :to="t.to"
        class="ad-tab"
        :class="{ 'ad-tab--active': route.path === t.to }"
      >
        <Icon :icon="t.icon" class="ad-tab-icon" />{{ t.label }}
      </router-link>
    </nav>

    <main class="ad-main">
      <slot />
    </main>

    <section class="ad-card ad-logs-card">
      <div class="ad-logs-header" @click="toggleLogs">
        <h2 class="ad-card-title">
          <Icon icon="ph:terminal-duotone" class="ad-card-icon" />
          系统日志
          <span v-if="logs.length" class="ad-logs-count">{{ logs.length }}</span>
        </h2>
        <div class="ad-logs-actions">
          <button v-if="showLogs" class="ad-logs-refresh" @click.stop="loadLogs" :disabled="logsLoading">
            <Icon :icon="logsLoading ? 'ph:spinner-gap-bold' : 'ph:arrows-clockwise'" :class="{ 'ph-spin': logsLoading }" />
          </button>
          <Icon :icon="showLogs ? 'ph:caret-up-duotone' : 'ph:caret-down-duotone'" class="ad-logs-toggle" />
        </div>
      </div>
      <div v-if="showLogs" class="ad-logs-body">
        <p v-if="logsError" class="ad-logs-empty">{{ logsError }}</p>
        <p v-else-if="!logs.length" class="ad-logs-empty">{{ logsLoading ? "加载中..." : "暂无日志" }}</p>
        <div v-for="(e, i) in logs" :key="i" class="ad-log-entry" :class="`ad-log-${e.level.toLowerCase()}`">
          <span class="ad-log-time">{{ e.time }}</span>
          <span class="ad-log-level">{{ e.level }}</span>
          <pre class="ad-log-msg">{{ e.message }}</pre>
        </div>
      </div>
    </section>
  </div>
</template>
