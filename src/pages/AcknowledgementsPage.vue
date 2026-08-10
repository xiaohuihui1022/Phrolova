<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from "vue";
import { useRouter } from "vue-router";
import { Icon } from "@iconify/vue";

import EmptyState from "@/components/shared/EmptyState.vue";
import { fetchAcknowledgements, type AcknowledgementItem } from "@/api";

const router = useRouter();
const loading = shallowRef(false);
const list = ref<AcknowledgementItem[]>([]);

const CATEGORY_META: Record<string, { label: string; icon: string; color: string }> = {
  bug: { label: "Bug 反馈", icon: "ph:bug-duotone", color: "var(--danger)" },
  feature: { label: "功能建议", icon: "ph:lightbulb-duotone", color: "var(--gold)" },
  support: { label: "技术支持", icon: "ph:heart-duotone", color: "var(--accent)" },
  dev: { label: "开发人员", icon: "ph:code-duotone", color: "var(--accent-3)" },
  other: { label: "其他贡献", icon: "ph:star-duotone", color: "var(--accent-2)" },
};

function categoryMeta(cat: string) {
  return CATEGORY_META[cat] ?? CATEGORY_META.other;
}

const grouped = computed(() => {
  const result: Record<string, AcknowledgementItem[]> = {};
  for (const item of list.value) {
    const key = item.category || "other";
    if (!result[key]) result[key] = [];
    result[key].push(item);
  }
  return result;
});

const categoryOrder = ["dev", "bug", "feature", "support", "other"];

async function loadList() {
  loading.value = true;
  try {
    const data = await fetchAcknowledgements();
    list.value = data.list ?? [];
  } catch { /* silent */ }
  finally { loading.value = false; }
}

/** 头像图片加载失败时清空 avatar，自动回退到首字母占位 */
function onAvatarError(item: AcknowledgementItem, e: Event) {
  item.avatar = null;
  const img = e.target as HTMLImageElement;
  if (img) img.style.display = "none";
}

onMounted(loadList);
</script>

<template>
  <div class="ack-page">
    <header class="ack-top">
      <button class="back-btn" @click="router.push('/')">
        <Icon icon="ph:arrow-left-duotone" /> BACK
      </button>
      <div class="ack-header-center">
        <h1 class="ack-title">致谢名单</h1>
        <p class="ack-sub">Acknowledgements · 感谢每一位为社区贡献力量的朋友</p>
      </div>
      <div class="ack-header-right" />
    </header>

    <main class="ack-main">
      <div v-if="loading" class="ack-card">
        <p class="ack-loading"><Icon icon="ph:spinner-gap-bold" class="ph-spin" /> 加载中...</p>
      </div>

      <EmptyState
        v-else-if="!list.length"
        icon="ph:hand-heart-duotone"
        title="暂无致谢名单"
        description="后续会把帮忙提问题、找 bug 的用户 ID 挂上来~"
      />

      <template v-else>
        <section
          v-for="cat in categoryOrder"
          :key="cat"
          v-show="grouped[cat]?.length"
          class="ack-card"
        >
          <header class="ack-cat-header">
            <Icon :icon="categoryMeta(cat).icon" class="ack-cat-icon" :style="{ color: categoryMeta(cat).color }" />
            <h2 class="ack-cat-title">{{ categoryMeta(cat).label }}</h2>
            <span class="ack-cat-count">{{ grouped[cat]?.length }}</span>
          </header>

          <ul class="ack-list">
            <li v-for="item in grouped[cat]" :key="item.id" class="ack-item">
              <div class="ack-item-avatar">
                <img
                  v-if="item.avatar"
                  :src="item.avatar"
                  :alt="item.player_id"
                  class="ack-item-avatar-img"
                  loading="lazy"
                  @error="onAvatarError(item, $event)"
                />
                <span v-else class="ack-item-avatar-letter">{{ item.player_id.charAt(0)?.toUpperCase() }}</span>
              </div>
              <div class="ack-item-body">
                <div class="ack-item-name">{{ item.player_id }}</div>
                <p v-if="item.description" class="ack-item-desc">{{ item.description }}</p>
              </div>
            </li>
          </ul>
        </section>

        <footer class="ack-footer">
          <p class="ack-footer-text">
            <Icon icon="ph:heart-duotone" style="color: var(--danger)" />
            感谢每一位提交 Bug、提出建议和帮助测试的玩家！
          </p>
        </footer>
      </template>
    </main>
  </div>
</template>
