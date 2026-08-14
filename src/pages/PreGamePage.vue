<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import gsap from "gsap";

import GlassHeader from "@/components/shared/GlassHeader.vue";
import { useTheme } from "@/composables/useTheme";
import { useDictionaryStore } from "@/stores/dictionary";
import { useSingleGameStore } from "@/stores/singleGame";
import type { Difficulty, QuizType } from "@/types";

const { theme } = useTheme();
const { t } = useI18n();
const dictionaryStore = useDictionaryStore();
const singleGameStore = useSingleGameStore();
const router = useRouter();

const gameModes = [
  {
    key: "resonator" as QuizType,
    icon: "ph:user-circle-duotone",
    kicker: "RESONATOR",
    titleKey: "single.resonatorMode",
    descKey: "single.resonatorDesc",
    guesses: 4,
    fields: 5 as number | null,
    fieldsRange: null as string | null,
  },
  {
    key: "skeleton" as QuizType,
    icon: "ph:ghost-duotone",
    kicker: "SKELETON",
    titleKey: "single.skeletonMode",
    descKey: "single.skeletonDesc",
    guesses: 8,
    fields: null as number | null,
    fieldsRange: "3-5" as string | null,
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
        :kicker="t('single.modeSelectKicker')"
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
            <strong class="pg-card-title">{{ t(mode.titleKey) }}</strong>
            <p class="pg-card-desc">{{ t("single.modeCardDesc", { n: mode.guesses, desc: t(mode.descKey) }) }}</p>
            <div class="pg-card-stats">
              <div class="pg-card-stat">
                <Icon icon="ph:target-duotone" aria-hidden="true" />
                <span>{{ t("single.guessesN", { n: mode.guesses }) }}</span>
              </div>
              <div class="pg-card-stat">
                <Icon icon="ph:columns-duotone" aria-hidden="true" />
                <span>{{
                  mode.fieldsRange
                    ? t("single.fieldsRange", { range: mode.fieldsRange })
                    : t("single.fieldsN", { n: mode.fields ?? 0 })
                }}</span>
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
                <Icon icon="ph:leaf-duotone" aria-hidden="true" /> {{ t("single.easy") }}
              </button>
              <button
                class="pg-diff-tab"
                :class="{ 'pg-diff-tab--active': config.difficulty === 'hard' }"
                @click="config.difficulty = 'hard'"
              >
                <Icon icon="ph:flame-duotone" aria-hidden="true" /> {{ t("single.hard") }}
              </button>
            </div>
          </div>
        </Transition>

        <button class="btn-start" :disabled="loading" @click="startGame">
          <Icon icon="ph:play-circle-duotone" aria-hidden="true" />
          {{ loading ? t("common.loading") : t("single.startChallenge") }}
        </button>
      </div>
    </div>
  </div>
</template>

