<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef, useTemplateRef } from "vue";
import { useRouter } from "vue-router";
import gsap from "gsap";

import FeedbackLegend from "@/components/game/FeedbackLegend.vue";
import GuessTable from "@/components/game/GuessTable.vue";
import NameAutocompleteInput from "@/components/game/NameAutocompleteInput.vue";
import GlassHeader from "@/components/shared/GlassHeader.vue";
import ModalOverlay from "@/components/shared/ModalOverlay.vue";
import { useTheme } from "@/composables/useTheme";
import { useDictionaryStore } from "@/stores/dictionary";
import { useSingleGameStore } from "@/stores/singleGame";

const { theme } = useTheme();
const dictionaryStore = useDictionaryStore();
const singleGameStore = useSingleGameStore();
const router = useRouter();
const guessName = shallowRef("");
const guessInputRef = useTemplateRef<{ focus: () => void }>("guessInput");

const currentNames = computed(() =>
  singleGameStore.quizType === "skeleton" ? dictionaryStore.skeletonNames : dictionaryStore.resonatorNames,
);

const modeTitle = computed(() => {
  if (singleGameStore.quizType === "skeleton") return `声骸推演 / ${singleGameStore.difficulty === "easy" ? "简单" : "困难"}`;
  return "共鸣者推演 / 标准";
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
  singleGameStore.quizType === "skeleton" ? "在下方输入声骸名称开始猜测" : "在下方输入角色昵称开始猜测",
);

const stagePromptSubtitle = computed(() =>
  singleGameStore.quizType === "skeleton"
    ? "根据 COST、属性、异相与套装反馈逐步缩小范围"
    : "绿色正确，黄色接近，箭头提示目标数值方向",
);

const isWin = computed(() => singleGameStore.resultMessage === "回答正确，本局已完成。");

const roundEndTitle = computed(() => {
  if (isWin.value) return "回答正确";
  if (singleGameStore.resultMessage === "已显示本局答案。") return "已揭晓答案";
  return "机会已用尽";
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

/** 点击提交按钮：自动补全到第一个匹配项再提交，与按 Enter 键效果一致。 */
function handleClickSubmit() {
  const keyword = guessName.value.trim().toLowerCase();
  if (keyword) {
    const match = currentNames.value.find((n) => n.name.toLowerCase().includes(keyword));
    if (match) {
      guessName.value = match.name;
    }
  }
  submitGuess(guessName.value);
}

onMounted(async () => {
  await dictionaryStore.ensureLoaded(singleGameStore.quizType);
  await restartGame();
  gsap.from(".sg-glass-header", { opacity: 0, y: -20, duration: 0.45, ease: "power2.out" });
});
</script>

<template>
  <div class="game-screen">
    <div class="game-shell">
      <GlassHeader
        class="sg-glass-header"
        kicker="单人 · 猜测模式"
        :title="modeTitle"
        back-to="/single"
      >
        <template #actions>
          <button class="glass-header-btn" @click="singleGameStore.revealAnswer()" title="查看答案">
            <Icon icon="ph:eye-duotone" aria-hidden="true" />
          </button>
          <button class="glass-header-btn" @click="restartGame" title="重新开始">
            <Icon icon="ph:arrow-counter-clockwise-duotone" aria-hidden="true" />
          </button>
        </template>
      </GlassHeader>

      <div class="score-bar">
        <div class="score-item">
          <span class="score-label">已猜</span>
          <span class="score-value">{{ singleGameStore.attemptsUsed }}</span>
        </div>
        <div class="score-divider">/</div>
        <div class="score-item">
          <span class="score-label">上限</span>
          <span class="score-value">{{ singleGameStore.attemptsLimit }}</span>
        </div>
        <div class="score-divider score-divider--gap">·</div>
        <div class="score-item">
          <span class="score-label">剩余</span>
          <span class="score-value score-value--accent">{{ singleGameStore.attemptsLeft }}</span>
        </div>
      </div>

      <section class="game-stage sg-stage" :class="{ 'game-stage--empty': !hasGuessHistory }">
        <div class="stage-head">
          <div class="stage-copy">
            <p class="stage-kicker">PLAYFIELD</p>
            <h2 class="stage-title">{{ hasGuessHistory ? "猜测记录" : stagePromptTitle }}</h2>
            <p class="stage-sub">{{ hasGuessHistory ? "" : stagePromptSubtitle }}</p>
          </div>
          <FeedbackLegend v-if="hasGuessHistory" />
        </div>

        <div class="stage-body" :class="{ 'game-stage--empty': !hasGuessHistory }">
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
            <Icon icon="ph:keyboard-duotone" class="dock-label-icon" aria-hidden="true" /> 提交猜测
          </span>
          <span class="dock-meta">{{ singleGameStore.loading ? "正在处理本次猜测" : stagePromptTitle }}</span>
        </div>

        <div class="dock-input-row">
          <NameAutocompleteInput
            ref="guessInput"
            v-model="guessName"
            :disabled="!singleGameStore.canSubmit || singleGameStore.loading"
            :names="currentNames"
            :quiz-type="singleGameStore.quizType"
            :placeholder="singleGameStore.quizType === 'skeleton' ? '输入声骸名称' : '输入角色昵称'"
            @submit="submitGuess"
          />
          <button class="btn btn-submit" :disabled="!singleGameStore.canSubmit || singleGameStore.loading" @click="handleClickSubmit">
            <Icon icon="ph:paper-plane-right-duotone" class="btn-icon" aria-hidden="true" /> 提交
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
          <p class="sg-win-answer-label">正确答案</p>
          <p class="sg-win-answer">{{ answerText }}</p>
          <p v-if="isWin" class="sg-win-attempts">仅用 {{ singleGameStore.attemptsUsed }} 次猜测</p>
          <p v-if="singleGameStore.earnedScore" class="sg-win-score">+{{ singleGameStore.earnedScore }} 分</p>
          <div class="sg-win-actions">
            <button class="btn" @click="restartGame">再来一局</button>
            <button class="btn-ghost" @click="router.push('/single')">返回模式选择</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

