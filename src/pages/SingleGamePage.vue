<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, useTemplateRef, watch } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import gsap from "gsap";

import FeedbackLegend from "@/components/game/FeedbackLegend.vue";
import GuessTable from "@/components/game/GuessTable.vue";
import NameAutocompleteInput from "@/components/game/NameAutocompleteInput.vue";
import GlassHeader from "@/components/shared/GlassHeader.vue";
import ModalOverlay from "@/components/shared/ModalOverlay.vue";
import { useTheme } from "@/composables/useTheme";
import { useDictionaryStore } from "@/stores/dictionary";
import { useSingleGameStore } from "@/stores/singleGame";
import { useAuthStore } from "@/stores/auth";

const { theme } = useTheme();
const { t } = useI18n();
const dictionaryStore = useDictionaryStore();
const singleGameStore = useSingleGameStore();
const authStore = useAuthStore();
const router = useRouter();
const guessName = shallowRef("");
const guessInputRef = useTemplateRef<{ focus: () => void; resolveFinalName: () => string }>("guessInput");

/** 单人模式猜测记录的滚动容器 */
const stageBodyRef = ref<HTMLElement | null>(null);

/** 滚到最新一条猜测；同时兼容内层 .guess-table-shell 的 overflow:auto */
function scrollStageToBottom(el: HTMLElement | null) {
  if (!el) return;
  el.scrollTop = el.scrollHeight;
  const innerShell = el.querySelector<HTMLElement>(".guess-table-shell");
  if (innerShell) innerShell.scrollTop = innerShell.scrollHeight;
}

/** 每次提交新猜测后自动滚到底部，和多人模式保持一致体验 */
let _lastGuessLen = 0;
watch(
  () => singleGameStore.guessHistory.length,
  (len) => {
    if (len > _lastGuessLen) {
      nextTick(() => {
        requestAnimationFrame(() => {
          scrollStageToBottom(stageBodyRef.value);
          setTimeout(() => scrollStageToBottom(stageBodyRef.value), 60);
        });
      });
    }
    _lastGuessLen = len;
  },
);

const currentNames = computed(() =>
  singleGameStore.quizType === "skeleton" ? dictionaryStore.skeletonNames : dictionaryStore.resonatorNames,
);

const modeTitle = computed(() => {
  if (singleGameStore.quizType === "skeleton") {
    return singleGameStore.difficulty === "easy" ? t("single.skeletonTitleEasy") : t("single.skeletonTitleHard");
  }
  return t("single.resonatorTitle");
});

const targetVersion = computed(() => {
  if (singleGameStore.quizType !== "resonator" || !singleGameStore.target || !("version" in singleGameStore.target)) return null;
  return Number(singleGameStore.target.version);
});

const targetCost = computed(() => {
  if (singleGameStore.quizType !== "skeleton" || !singleGameStore.target || !("cost" in singleGameStore.target)) return null;
  return Number(singleGameStore.target.cost);
});

const answerText = computed(() => {
  const target = singleGameStore.target;
  if (!target) return "";
  if (singleGameStore.quizType === "skeleton") {
    const t = target;
    return `${t.name} / COST ${'cost' in t ? t.cost : '?'} / ${'skill_attribute' in t ? t.skill_attribute : '?'}`;
  }
  const t = target;
  return `${t.name} / ${'attribute' in t ? t.attribute : '?'} / ${'weapon' in t ? t.weapon : '?'} / ${'version' in t ? t.version : '?'}`;
});

const hasGuessHistory = computed(() => singleGameStore.guessHistory.length > 0);

const stagePromptTitle = computed(() =>
  singleGameStore.quizType === "skeleton" ? t("single.skeletonPromptTitle") : t("single.resonatorPromptTitle"),
);

const stagePromptSubtitle = computed(() =>
  singleGameStore.quizType === "skeleton"
    ? t("single.skeletonPromptSubtitle")
    : t("single.resonatorPromptSubtitle"),
);

const isWin = computed(() => singleGameStore.resultStatus === "win");

const roundEndTitle = computed(() => {
  if (singleGameStore.resultStatus === "win") return t("single.winTitle");
  if (singleGameStore.resultStatus === "revealed") return t("single.revealedTitle");
  return t("single.lostTitle");
});

const modalDismissed = ref(false);

const showRoundEndModal = computed(() =>
  singleGameStore.gameOver && !modalDismissed.value,
);

function closeRoundEndModal() {
  modalDismissed.value = true;
}

async function restartGame() {
  try {
    await singleGameStore.startGame();
    guessName.value = "";
    modalDismissed.value = false;
    gsap.from(".sg-stage", { opacity: 0, y: 16, duration: 0.4, ease: "power2.out" });
  } catch {
    return;
  }
}

async function submitGuess(finalName?: string) {
  const name = (finalName ?? guessName.value).trim();
  if (!name) return;
  try {
    await singleGameStore.submitGuess(name);
    guessName.value = "";
    nextTick(() => guessInputRef.value?.focus());
  } catch {
    guessInputRef.value?.focus();
    return;
  }
}

/** 点击提交按钮：使用组件内部逻辑 resolveFinalName 获取最终名称（考虑 activeIndex）。 */
function handleClickSubmit() {
  const finalName = guessInputRef.value?.resolveFinalName() ?? guessName.value;
  submitGuess(finalName);
}

/**
 * 玩家关闭/离开页面时，通过 sendBeacon 通知后端标记目标会话 10s 后过期。
 * sendBeacon 不支持自定义 header，所以 auth 走 query params（后端 readPlayerAuth 三级回退已覆盖）。
 * 10s 宽限期用于区分"刷新页面"和"真正离开"：刷新后重新抽题会 upsert 新行，旧行的 expires_at 被清除。
 */
function handlePageHide() {
  const pid = authStore.playerId;
  const tok = authStore.token;
  if (!pid || !tok) return;
  const url = `/api/player/leave?player_id=${encodeURIComponent(pid)}&token=${encodeURIComponent(tok)}`;
  try {
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon(url);
    } else {
      // 兜底：fetch keepalive 也能在页面卸载时发出请求
      void fetch(url, { method: "POST", keepalive: true }).catch(() => undefined);
    }
  } catch { /* ignore */ }
}

onMounted(async () => {
  window.addEventListener("pagehide", handlePageHide);
  await dictionaryStore.ensureLoaded(singleGameStore.quizType);
  await restartGame();
  gsap.from(".sg-glass-header", { opacity: 0, y: -20, duration: 0.45, ease: "power2.out" });
});

onUnmounted(() => {
  window.removeEventListener("pagehide", handlePageHide);
});
</script>

<template>
  <div class="game-screen">
    <div class="game-shell">
      <GlassHeader
        class="sg-glass-header"
        :kicker="t('single.playKicker')"
        :title="modeTitle"
        back-to="/single"
      >
        <template #actions>
          <button class="glass-header-btn" @click="singleGameStore.revealAnswer()" :title="t('single.revealAnswer')">
            <Icon icon="ph:eye-duotone" aria-hidden="true" />
          </button>
          <button class="glass-header-btn" @click="restartGame" :title="t('single.restart')">
            <Icon icon="ph:arrow-counter-clockwise-duotone" aria-hidden="true" />
          </button>
        </template>
      </GlassHeader>

      <div class="score-bar">
        <div class="score-item">
          <span class="score-label">{{ t("single.guessed") }}</span>
          <span class="score-value">{{ singleGameStore.attemptsUsed }}</span>
        </div>
        <div class="score-divider">/</div>
        <div class="score-item">
          <span class="score-label">{{ t("single.limit") }}</span>
          <span class="score-value">{{ singleGameStore.attemptsLimit }}</span>
        </div>
        <div class="score-divider score-divider--gap">·</div>
        <div class="score-item">
          <span class="score-label">{{ t("single.remaining") }}</span>
          <span class="score-value score-value--accent">{{ singleGameStore.attemptsLeft }}</span>
        </div>
      </div>

      <section class="game-stage sg-stage" :class="{ 'game-stage--empty': !hasGuessHistory }">
        <div class="stage-head">
          <div class="stage-copy">
            <p class="stage-kicker">PLAYFIELD</p>
            <h2 class="stage-title">{{ hasGuessHistory ? t("single.guessHistory") : stagePromptTitle }}</h2>
            <p class="stage-sub">{{ hasGuessHistory ? "" : stagePromptSubtitle }}</p>
          </div>
          <FeedbackLegend v-if="hasGuessHistory" />
        </div>

        <div ref="stageBodyRef" class="stage-body" :class="{ 'game-stage--empty': !hasGuessHistory }">
          <div v-if="!hasGuessHistory" class="sg-empty-state">
            <div class="sg-empty-glyph"><Icon icon="ph:target-duotone" aria-hidden="true" /></div>
            <h2 class="stage-title">{{ stagePromptTitle }}</h2>
            <p class="stage-sub">{{ stagePromptSubtitle }}</p>
            <FeedbackLegend />
          </div>
          <GuessTable
            v-else
            :quiz-type="singleGameStore.quizType"
            :rows="singleGameStore.guessHistory"
            empty-label=""
            :target-version="targetVersion"
            :target-cost="targetCost"
          />
        </div>
      </section>

      <footer class="game-dock">
        <div class="dock-copy">
          <span class="dock-label">
            <Icon icon="ph:keyboard-duotone" class="dock-label-icon" aria-hidden="true" /> {{ t("single.submitGuess") }}
          </span>
          <span class="dock-meta">{{ singleGameStore.loading ? t("single.processing") : stagePromptTitle }}</span>
        </div>

        <div class="dock-input-row">
          <NameAutocompleteInput
            ref="guessInput"
            v-model="guessName"
            :disabled="!singleGameStore.canSubmit || singleGameStore.loading"
            :names="currentNames"
            :quiz-type="singleGameStore.quizType"
            :placeholder="singleGameStore.quizType === 'skeleton' ? t('single.skeletonPlaceholder') : t('single.resonatorPlaceholder')"
            @submit="submitGuess"
          />
          <button class="btn btn-submit" :disabled="!singleGameStore.canSubmit || singleGameStore.loading" @click="handleClickSubmit">
            <Icon icon="ph:paper-plane-right-duotone" class="btn-icon" aria-hidden="true" /> {{ t("single.submit") }}
          </button>
        </div>
      </footer>
    </div>

    <Teleport v-if="showRoundEndModal" to="body">
      <div class="sg-win-overlay" @click.self="closeRoundEndModal">
        <div class="sg-win-modal">
          <div class="sg-win-icon" :class="{ 'sg-win-icon--win': isWin, 'sg-win-icon--lose': !isWin }">
            <Icon :icon="isWin ? 'ph:crown-duotone' : 'ph:eye-duotone'" aria-hidden="true" />
          </div>
          <h2 class="sg-win-title">{{ roundEndTitle }}</h2>
          <p class="sg-win-answer-label">{{ t("single.correctAnswer") }}</p>
          <p class="sg-win-answer">{{ answerText }}</p>
          <p v-if="isWin" class="sg-win-attempts">{{ t("single.attemptsUsedN", { n: singleGameStore.attemptsUsed }) }}</p>
          <p v-if="singleGameStore.earnedScore" class="sg-win-score">{{ t("single.scoreGained", { n: singleGameStore.earnedScore }) }}</p>
          <div class="sg-win-actions">
            <button class="btn" @click="restartGame">{{ t("single.playAgain") }}</button>
            <button class="btn-ghost" @click="router.push('/single')">{{ t("single.backToModeSelect") }}</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

