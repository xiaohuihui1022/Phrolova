<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from "vue";
import { useRouter } from "vue-router";
import { Icon } from "@iconify/vue";
import { useI18n } from "vue-i18n";

import EmptyState from "@/components/shared/EmptyState.vue";
import { fetchAcknowledgements, type AcknowledgementItem } from "@/api";
import { sanitizeHtml } from "@/utils/sanitize";

const router = useRouter();
const { t } = useI18n();
const loading = shallowRef(false);
const list = ref<AcknowledgementItem[]>([]);

const CATEGORY_META: Record<string, { labelKey: string; icon: string; color: string }> = {
  bug: { labelKey: "acknowledgements.catBug", icon: "ph:bug-duotone", color: "var(--danger)" },
  feature: { labelKey: "acknowledgements.catFeature", icon: "ph:lightbulb-duotone", color: "var(--gold)" },
  support: { labelKey: "acknowledgements.catSupport", icon: "ph:heart-duotone", color: "var(--accent)" },
  dev: { labelKey: "acknowledgements.catDev", icon: "ph:code-duotone", color: "var(--accent-3)" },
  other: { labelKey: "acknowledgements.catOther", icon: "ph:star-duotone", color: "var(--accent-2)" },
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

/** 描述：清理后通过 v-html 渲染，支持简单安全 HTML（<a>、<br>、<b> 等） */
function renderDescription(desc: string | null | undefined): string {
  return sanitizeHtml(desc);
}

onMounted(loadList);
</script>

<template>
  <div class="ack-page">
    <header class="ack-top">
      <button class="back-btn" @click="router.push('/')">
        <Icon icon="ph:arrow-left-duotone" /> {{ t("acknowledgements.back") }}
      </button>
      <div class="ack-header-center">
        <h1 class="ack-title">{{ t("acknowledgements.pageTitle") }}</h1>
        <p class="ack-sub">{{ t("acknowledgements.pageSubtitle") }}</p>
      </div>
      <div class="ack-header-right" />
    </header>

    <main class="ack-main">
      <div v-if="loading" class="ack-card">
        <p class="ack-loading"><Icon icon="ph:spinner-gap-bold" class="ph-spin" /> {{ t("acknowledgements.loading") }}</p>
      </div>

      <EmptyState
        v-else-if="!list.length"
        icon="ph:hand-heart-duotone"
        :title="t('acknowledgements.emptyTitle')"
        :description="t('acknowledgements.emptyDesc')"
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
            <h2 class="ack-cat-title">{{ t(categoryMeta(cat).labelKey) }}</h2>
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
                <p
                  v-if="item.description"
                  class="ack-item-desc"
                  v-html="renderDescription(item.description)"
                ></p>
              </div>
            </li>
          </ul>
        </section>

        <footer class="ack-footer">
          <p class="ack-footer-text">
            <Icon icon="ph:heart-duotone" style="color: var(--danger)" />
            {{ t("acknowledgements.footerText") }}
          </p>
        </footer>
      </template>
    </main>
  </div>
</template>
