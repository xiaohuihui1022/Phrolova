<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from "vue";
import { useRouter } from "vue-router";

import Pagination from "@/components/shared/Pagination.vue";
import TabGroup from "@/components/shared/TabGroup.vue";
import type { QuizType, ResonatorNameEntry, SkeletonNameEntry, TabOption } from "@/types";
import { useDictionaryStore } from "@/stores/dictionary";
import { getCharacterAvatar, getSkeletonAvatar } from "@/utils/game";

const router = useRouter();
const dictionaryStore = useDictionaryStore();
const tab = ref<QuizType>("resonator");
const search = ref("");
const loading = shallowRef(false);
const page = ref(1);
const PAGE_SIZE = 20;

const tabOptions: TabOption[] = [
  { key: "resonator", label: "共鸣者" },
  { key: "skeleton", label: "声骸" },
];

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
  const q = search.value.toLowerCase();
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
  const q = search.value.toLowerCase();
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
  return c.name.toLowerCase().includes(q)
    || c.attribute.toLowerCase().includes(q)
    || c.weapon.toLowerCase().includes(q)
    || c.birthplace.toLowerCase().includes(q)
    || String(c.version).includes(q);
}

function matchSkeleton(s: SkeletonNameEntry, q: string) {
  return s.name.toLowerCase().includes(q)
    || s.skill_attribute.toLowerCase().includes(q)
    || s.set_name.toLowerCase().includes(q)
    || s.drop_location.toLowerCase().includes(q)
    || s.is_aberration.toLowerCase().includes(q)
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
        <Icon icon="ph:arrow-left-duotone" /> BACK
      </button>
      <h1 class="dp-title">数据图鉴</h1>
      <div class="dp-top-right" />
    </header>

    <TabGroup :tabs="tabOptions" :active-key="tab" @select="onTabChange" />

    <div class="dp-search">
      <Icon icon="ph:magnifying-glass-duotone" class="dp-search-icon" />
      <input v-model="search" class="dp-search-input" :placeholder="tab === 'resonator' ? '搜索角色名称或属性...' : '搜索声骸名称、属性或套装...'" @input="onSearchChange" />
    </div>

    <!-- Token filters -->
    <div class="dp-filters" v-if="!loading">
      <template v-if="tab === 'resonator'">
        <div v-for="(values, field) in resonatorFilters" :key="field" class="dp-filter-group">
          <span class="dp-filter-label">{{ { attribute: '属性', weapon: '武器', birthplace: '出生地', star_rating: '星级' }[field as string] }}</span>
          <button v-for="v in values" :key="v" class="dp-filter-chip" :class="{ 'dp-filter-chip--active': hasFilter(field as string, v) }" @click="toggleFilter(field as string, v)">{{ v }}</button>
        </div>
      </template>
      <template v-else>
        <div v-for="(values, field) in skeletonFilters" :key="field" class="dp-filter-group">
          <span class="dp-filter-label">{{ { skill_attribute: '属性', cost: 'COST', is_aberration: '异相', set_name: '套装', drop_location: '位置' }[field as string] }}</span>
          <button v-for="v in values" :key="v" class="dp-filter-chip" :class="{ 'dp-filter-chip--active': hasFilter(field as string, v) }" @click="toggleFilter(field as string, v)">{{ v }}</button>
        </div>
      </template>
    </div>

    <div v-if="loading" class="dp-loading">加载中...</div>

    <template v-else>
      <p class="dp-count">{{ totalCount }} 条结果</p>

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
              <div class="dp-row"><dt>属性</dt><dd>{{ char.attribute }}</dd></div>
              <div class="dp-row"><dt>武器</dt><dd>{{ char.weapon }}</dd></div>
              <div class="dp-row"><dt>出生地</dt><dd>{{ char.birthplace }}</dd></div>
              <div class="dp-row"><dt>版本</dt><dd>{{ char.version }}</dd></div>
            </dl>
          </div>
        </template>
        <template v-else>
          <div v-for="sk in pagedItems" :key="sk.name" class="dp-card">
            <div class="dp-card-head">
              <img :src="getSkeletonAvatar(sk.name)" class="dp-card-avatar" alt="" loading="lazy" />
              <div class="dp-card-title">
                <strong class="dp-card-name">{{ sk.name }}</strong>
                <span class="dp-card-stars">COST {{ sk.cost }} · {{ sk.is_aberration === '有' ? '异相' : '常规' }}</span>
              </div>
            </div>
            <dl class="dp-card-detail">
              <div class="dp-row"><dt>技能属性</dt><dd>{{ sk.skill_attribute }}</dd></div>
              <div class="dp-row"><dt>套装</dt><dd>{{ sk.set_name }}</dd></div>
              <div class="dp-row"><dt>掉落位置</dt><dd>{{ sk.drop_location }}</dd></div>
            </dl>
          </div>
        </template>
        <p v-if="!pagedItems.length" class="dp-empty">未找到匹配结果</p>
      </div>

      <Pagination v-if="totalPages > 1" :current="page" :total="totalCount" :size="PAGE_SIZE" @change="page = $event" />
    </template>
  </div>
</template>
