<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import gsap from "gsap";

import GlassHeader from "@/components/shared/GlassHeader.vue";
import { useTheme } from "@/composables/useTheme";
import { useDictionaryStore } from "@/stores/dictionary";
import { useSingleGameStore } from "@/stores/singleGame";
import type { Difficulty, QuizType } from "@/types";

const { theme } = useTheme();
const dictionaryStore = useDictionaryStore();
const singleGameStore = useSingleGameStore();
const router = useRouter();

const gameModes = [
  {
    key: "resonator" as QuizType,
    icon: "ph:user-circle-duotone",
    kicker: "RESONATOR",
    title: "共鸣者模式",
    desc: "比较属性、星级、武器、出生地与实装版本。",
    guesses: 4,
    stats: [
      { icon: "ph:target-duotone", text: "4 次猜测" },
      { icon: "ph:columns-duotone", text: "5 个字段" },
    ],
  },
  {
    key: "skeleton" as QuizType,
    icon: "ph:ghost-duotone",
    kicker: "SKELETON",
    title: "声骸模式",
    desc: "反馈属性、COST、技能、套装与掉落位置。",
    guesses: 8,
    stats: [
      { icon: "ph:target-duotone", text: "8 次猜测" },
      { icon: "ph:columns-duotone", text: "3-5 个字段" },
    ],
  },
];

const config = reactive({
  quizType: "resonator" as QuizType,
  difficulty: "hard" as Difficulty,
});

const loading = ref(false);
let ctx: gsap.Context | null = null;

async function startGame() {
  if (loading.value) return;
  loading.value = true;
  try {
    singleGameStore.setConfig(config.quizType, config.difficulty);
    await dictionaryStore.ensureLoaded(config.quizType);
    router.push("/single/play");
  } catch {
    loading.value = false;
  }
}

onMounted(() => {
  nextTick(() => {
    ctx = gsap.context(() => {
      gsap.from(".pg-glass-header", { opacity: 0, y: -20, duration: 0.5, ease: "power2.out" });
      gsap.from(".pg-cards", { opacity: 0, y: 40, duration: 0.7, ease: "power3.out", delay: 0.12 });
      gsap.from(".pg-foot", { opacity: 0, y: 24, duration: 0.55, ease: "power2.out", delay: 0.3 });
      gsap.from(".pg-orb", { opacity: 0, scale: 0.6, duration: 1, ease: "power3.out", delay: 0.5 });
    });
  });
});

onBeforeUnmount(() => {
  ctx?.revert();
});
</script>

<template>
  <div class="pg-root">
    <div class="pg-shell">
      <GlassHeader
        class="pg-glass-header"
        kicker="单人 · 模式选择"
        title="Select Mode"
        back-to="/"
      />

      <div class="pg-orb" aria-hidden="true"></div>

      <div class="pg-cards">
        <button
          v-for="mode in gameModes"
          :key="mode.key"
          class="pg-card"
          :class="{ 'pg-card--active': config.quizType === mode.key }"
          @click="config.quizType = mode.key"
        >
          <div class="pg-card-border" aria-hidden="true"></div>
          <div class="pg-card-glow" aria-hidden="true"></div>
          <div class="pg-card-badge">
            <Icon :icon="mode.icon" aria-hidden="true" />
          </div>
          <div class="pg-card-body">
            <span class="pg-card-kicker">{{ mode.kicker }}</span>
            <strong class="pg-card-title">{{ mode.title }}</strong>
            <p class="pg-card-desc">每题 <em>{{ mode.guesses }}</em> 次猜测机会，{{ mode.desc }}</p>
            <div class="pg-card-stats">
              <div v-for="stat in mode.stats" :key="stat.text" class="pg-card-stat">
                <Icon :icon="stat.icon" aria-hidden="true" />
                <span>{{ stat.text }}</span>
              </div>
            </div>
          </div>
          <div class="pg-card-check">
            <Icon :icon="config.quizType === mode.key ? 'ph:check-circle-duotone' : 'ph:circle-duotone'" aria-hidden="true" />
          </div>
        </button>
      </div>

      <div class="pg-foot">
        <Transition name="pg-diff-fade">
          <div v-if="config.quizType === 'skeleton'" class="pg-diff" key="diff">
            <span class="pg-diff-label">DIFFICULTY</span>
            <div class="pg-diff-tabs">
              <button
                class="pg-diff-tab"
                :class="{ 'pg-diff-tab--active': config.difficulty === 'easy' }"
                @click="config.difficulty = 'easy'"
              >
                <Icon icon="ph:leaf-duotone" aria-hidden="true" /> 简单
              </button>
              <button
                class="pg-diff-tab"
                :class="{ 'pg-diff-tab--active': config.difficulty === 'hard' }"
                @click="config.difficulty = 'hard'"
              >
                <Icon icon="ph:flame-duotone" aria-hidden="true" /> 困难
              </button>
            </div>
          </div>
        </Transition>

        <button class="btn-start" :disabled="loading" @click="startGame">
          <Icon icon="ph:play-circle-duotone" aria-hidden="true" />
          {{ loading ? "加载中..." : "开始挑战" }}
        </button>
      </div>
    </div>
  </div>
</template>

