<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";

import Pagination from "@/components/shared/Pagination.vue";
import TabGroup from "@/components/shared/TabGroup.vue";
import type { QuizType, ResonatorNameEntry, SkeletonNameEntry, TabOption } from "@/types";
import { useDictionaryStore } from "@/stores/dictionary";
import { getCharacterAvatar, getSkeletonAvatar } from "@/utils/game";
import { normalizeSearchText } from "@/utils/chinese-convert";

const router = useRouter();
const { t } = useI18n();
const dictionaryStore = useDictionaryStore();
const tab = ref<QuizType>("resonator");
const search = ref("");
const loading = shallowRef(false);
const page = ref(1);
const PAGE_SIZE = 20;

const tabOptions = computed<TabOption[]>(() => [
  { key: "resonator", label: t("multi.tabResonator") },
  { key: "skeleton", label: t("multi.tabSkeleton") },
]);

// 过滤器字段名 → i18n key 映射
const resonatorFilterLabelKey: Record<string, string> = {
  attribute: "data.filterAttribute",
  weapon: "data.filterWeapon",
  birthplace: "data.filterBirthplace",
  star_rating: "data.filterStarRating",
};
const skeletonFilterLabelKey: Record<string, string> = {
  skill_attribute: "data.filterSkillAttribute",
  cost: "data.filterCost",
  is_aberration: "data.filterIsAberration",
  set_name: "data.filterSetName",
  drop_location: "data.filterDropLocation",
};

const characters = computed(() => dictionaryStore.resonatorNames);
const skeletons = computed(() => dictionaryStore.skeletonNames);

// ── Resonator filter options ──
const resonatorFilters = computed(() => ({
  attribute: [...new Set(characters.value.map(c => c.attribute))].sort(),
  weapon: [...new Set(characters.value.map(c => c.weapon))].sort(),
  birthplace: [...new Set(characters.value.map(c => c.birthplace))].sort(),
  star_rating: [...new Set(characters.value.map(c => c.star_rating))].sort((a, b) => b - a),
}));

// ── Skeleton filter options ──
const skeletonFilters = computed(() => ({
  skill_attribute: [...new Set(skeletons.value.flatMap(s => s.skill_attribute.split(",").map(x => x.trim())))].filter(Boolean).sort(),
  cost: [...new Set(skeletons.value.map(s => s.cost))].sort((a, b) => a - b),
  is_aberration: ["有", "无"],
  set_name: [...new Set(skeletons.value.flatMap(s => s.set_name.split(",").map(x => x.trim())))].filter(Boolean).sort(),
  drop_location: [...new Set(skeletons.value.flatMap(s => s.drop_location.split(",").map(x => x.trim())))].filter(Boolean).sort(),
}));

// ── Active filter state ──
type FilterKey = string;
const activeResFilter = ref<Record<string, Set<string>>>({});
const activeSkelFilter = ref<Record<string, Set<string>>>({});

function activeFilters() {
  return tab.value === "resonator" ? activeResFilter.value : activeSkelFilter.value;
}

function toggleFilter(field: string, value: string | number) {
  const filters = activeFilters();
  const key = String(value);
  if (!filters[field]) filters[field] = new Set();
  if (filters[field].has(key)) {
    filters[field].delete(key);
    if (!filters[field].size) delete filters[field];
  } else {
    filters[field].add(key);
  }
  page.value = 1;
}

function hasFilter(field: string, value: string | number): boolean {
  return activeFilters()[field]?.has(String(value)) ?? false;
}

// ── Filtered + searched data ──
const filteredCharacters = computed(() => {
  const q = normalizeSearchText(search.value);
  const filters = activeResFilter.value;
  return characters.value.filter(c => {
    if (q && !matchResonator(c, q)) return false;
    if (filters.attribute && !filters.attribute.has(c.attribute)) return false;
    if (filters.weapon && !filters.weapon.has(c.weapon)) return false;
    if (filters.birthplace && !filters.birthplace.has(c.birthplace)) return false;
    if (filters.star_rating && !filters.star_rating.has(String(c.star_rating))) return false;
    return true;
  });
});

const filteredSkeletons = computed(() => {
  const q = normalizeSearchText(search.value);
  const filters = activeSkelFilter.value;
  return skeletons.value.filter(s => {
    if (q && !matchSkeleton(s, q)) return false;
    if (filters.cost && !filters.cost.has(String(s.cost))) return false;
    if (filters.is_aberration && !filters.is_aberration.has(s.is_aberration)) return false;
    if (filters.skill_attribute && !s.skill_attribute.split(",").some(a => filters.skill_attribute!.has(a.trim()))) return false;
    if (filters.set_name && !s.set_name.split(",").some(n => filters.set_name!.has(n.trim()))) return false;
    if (filters.drop_location && !s.drop_location.split(",").some(l => filters.drop_location!.has(l.trim()))) return false;
    return true;
  });
});

const currentItems = computed(() => tab.value === "resonator" ? filteredCharacters.value : filteredSkeletons.value);
const totalCount = computed(() => currentItems.value.length);
const totalPages = computed(() => Math.ceil(totalCount.value / PAGE_SIZE));
const pagedItems = computed((): any[] => {
  const start = (page.value - 1) * PAGE_SIZE;
  return currentItems.value.slice(start, start + PAGE_SIZE);
});

function matchResonator(c: ResonatorNameEntry, q: string) {
  return normalizeSearchText(c.name).includes(q)
    || normalizeSearchText(c.attribute).includes(q)
    || normalizeSearchText(c.weapon).includes(q)
    || normalizeSearchText(c.birthplace).includes(q)
    || String(c.version).includes(q);
}

function matchSkeleton(s: SkeletonNameEntry, q: string) {
  return normalizeSearchText(s.name).includes(q)
    || normalizeSearchText(s.skill_attribute).includes(q)
    || normalizeSearchText(s.set_name).includes(q)
    || normalizeSearchText(s.drop_location).includes(q)
    || normalizeSearchText(s.is_aberration).includes(q)
    || String(s.cost).includes(q);
}

onMounted(async () => {
  loading.value = true;
  await Promise.all([
    dictionaryStore.loadResonatorNames(),
    dictionaryStore.loadSkeletonNames(),
  ]);
  loading.value = false;
});

// Reset page when tab or search changes
function onTabChange(key: string) {
  tab.value = key as QuizType;
  page.value = 1;
}
function onSearchChange() {
  page.value = 1;
}
</script>

<template>
  <div class="dp-page">
    <header class="dp-top">
      <button class="back-btn" @click="router.push('/')">
        <Icon icon="ph:arrow-left-duotone" /> {{ t("leaderboard.back") }}
      </button>
      <h1 class="dp-title">{{ t("data.pageTitle") }}</h1>
      <div class="dp-top-right" />
    </header>

    <TabGroup :tabs="tabOptions" :active-key="tab" @select="onTabChange" />

    <div class="dp-search">
      <Icon icon="ph:magnifying-glass-duotone" class="dp-search-icon" />
      <input v-model="search" class="dp-search-input" :placeholder="tab === 'resonator' ? t('data.searchPlaceholderResonator') : t('data.searchPlaceholderSkeleton')" @input="onSearchChange" />
    </div>

    <!-- Token filters -->
    <div class="dp-filters" v-if="!loading">
      <template v-if="tab === 'resonator'">
        <div v-for="(values, field) in resonatorFilters" :key="field" class="dp-filter-group">
          <span class="dp-filter-label">{{ t(resonatorFilterLabelKey[field as string]) }}</span>
          <button v-for="v in values" :key="v" class="dp-filter-chip" :class="{ 'dp-filter-chip--active': hasFilter(field as string, v) }" @click="toggleFilter(field as string, v)">{{ v }}</button>
        </div>
      </template>
      <template v-else>
        <div v-for="(values, field) in skeletonFilters" :key="field" class="dp-filter-group">
          <span class="dp-filter-label">{{ t(skeletonFilterLabelKey[field as string]) }}</span>
          <button v-for="v in values" :key="v" class="dp-filter-chip" :class="{ 'dp-filter-chip--active': hasFilter(field as string, v) }" @click="toggleFilter(field as string, v)">{{ v }}</button>
        </div>
      </template>
    </div>

    <div v-if="loading" class="dp-loading">{{ t("data.loading") }}</div>

    <template v-else>
      <p class="dp-count">{{ t("data.countResult", { count: totalCount }) }}</p>

      <div class="dp-grid" :class="{ 'dp-grid--empty': !pagedItems.length }">
        <template v-if="tab === 'resonator'">
          <div v-for="char in pagedItems" :key="char.name" class="dp-card">
            <div class="dp-card-head">
              <img :src="getCharacterAvatar(char.name)" class="dp-card-avatar" alt="" loading="lazy" />
              <div class="dp-card-title">
                <strong class="dp-card-name">{{ char.name }}</strong>
                <span class="dp-card-stars">{{ '★'.repeat(char.star_rating) }}</span>
              </div>
            </div>
            <dl class="dp-card-detail">
              <div class="dp-row"><dt>{{ t("data.fieldAttribute") }}</dt><dd>{{ char.attribute }}</dd></div>
              <div class="dp-row"><dt>{{ t("data.fieldWeapon") }}</dt><dd>{{ char.weapon }}</dd></div>
              <div class="dp-row"><dt>{{ t("data.fieldBirthplace") }}</dt><dd>{{ char.birthplace }}</dd></div>
              <div class="dp-row"><dt>{{ t("data.fieldVersion") }}</dt><dd>{{ char.version }}</dd></div>
            </dl>
          </div>
        </template>
        <template v-else>
          <div v-for="sk in pagedItems" :key="sk.name" class="dp-card">
            <div class="dp-card-head">
              <img :src="getSkeletonAvatar(sk.name)" class="dp-card-avatar" alt="" loading="lazy" />
              <div class="dp-card-title">
                <strong class="dp-card-name">{{ sk.name }}</strong>
                <span class="dp-card-stars">COST {{ sk.cost }} · {{ sk.is_aberration === '有' ? t('data.aberrationYes') : t('data.aberrationNo') }}</span>
              </div>
            </div>
            <dl class="dp-card-detail">
              <div class="dp-row"><dt>{{ t("data.fieldSkillAttribute") }}</dt><dd>{{ sk.skill_attribute }}</dd></div>
              <div class="dp-row"><dt>{{ t("data.fieldSetName") }}</dt><dd>{{ sk.set_name }}</dd></div>
              <div class="dp-row"><dt>{{ t("data.fieldDropLocation") }}</dt><dd>{{ sk.drop_location }}</dd></div>
            </dl>
          </div>
        </template>
        <p v-if="!pagedItems.length" class="dp-empty">{{ t("data.emptyResult") }}</p>
      </div>

      <Pagination v-if="totalPages > 1" :current="page" :total="totalCount" :size="PAGE_SIZE" @change="page = $event" />
    </template>
  </div>
</template>
