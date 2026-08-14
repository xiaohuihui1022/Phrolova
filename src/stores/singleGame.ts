import { computed, ref, shallowRef } from "vue";
import { defineStore } from "pinia";

import { useLocalStorage } from "@/composables/useStorage";
import type {
  Difficulty,
  GuessHistoryRow,
  QuizType,
  ResonatorCompare,
  ResonatorRow,
  SkeletonCompare,
  SkeletonRow,
} from "@/types";
import * as api from "@/api";
import { toHistoryRow } from "@/utils/game";
import { i18n } from "@/i18n";
import { useAuthStore } from "./auth";

function isWinningCompare(compare: ResonatorCompare | SkeletonCompare) {
  if ("skill_attribute" in compare) {
    return (
      compare.skill_attribute.cell === "match" &&
      compare.cost === "match" &&
      compare.is_aberration === "match" &&
      compare.set_name.cell === "match" &&
      compare.drop_location.cell === "match"
    );
  }
  return Object.values(compare).every((status) => status === "match");
}

export const useSingleGameStore = defineStore("singleGame", () => {
  const quizType = useLocalStorage<QuizType>("sg_quiz_type", "resonator");
  const difficulty = useLocalStorage<Difficulty>("sg_difficulty", "hard");
  const target = ref<ResonatorRow | SkeletonRow | null>(null);
  const guessHistory = ref<GuessHistoryRow[]>([]);
  const loading = shallowRef(false);
  const error = shallowRef("");
  const gameOver = shallowRef(false);
  const answerVisible = shallowRef(false);
  const resultStatus = shallowRef<"" | "win" | "lost" | "revealed">("");
  const earnedScore = shallowRef(0);

  const attemptsLimit = ref(4);
  function _updateLimit() { attemptsLimit.value = quizType.value === "skeleton" ? 8 : 4; }
  const attemptsUsed = computed(() => guessHistory.value.length);
  const attemptsLeft = computed(() => Math.max(0, attemptsLimit.value - attemptsUsed.value));
  const canSubmit = computed(() => !gameOver.value && attemptsLeft.value > 0);

  function setConfig(nextQuizType: QuizType, nextDifficulty: Difficulty) {
    quizType.value = nextQuizType;
    difficulty.value = nextDifficulty;
  }

  async function startGame() {
    loading.value = true;
    error.value = "";
    gameOver.value = false;
    answerVisible.value = false;
    resultStatus.value = "";
    guessHistory.value = [];
    _updateLimit();
    try {
      const authStore = useAuthStore();
      const data = await api.drawTarget(
        quizType.value,
        difficulty.value,
        authStore.playerId || undefined,
        authStore.token || undefined,
      );
      target.value = (data.character ?? null) as ResonatorRow | SkeletonRow | null;
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : i18n.global.t("single.startFailed");
      throw reason;
    } finally {
      loading.value = false;
    }
  }

  async function submitGuess(guessName: string) {
    if (!guessName.trim()) {
      throw new Error(i18n.global.t("single.emptyGuess"));
    }
    loading.value = true;
    error.value = "";
    earnedScore.value = 0;
    try {
      const authStore = useAuthStore();
      const isAuth = authStore.isAuthenticated;
      const data = await api.submitGuess(
        guessName,
        authStore.playerId,
        authStore.token,
        isAuth ? undefined : (target.value ?? undefined),
        isAuth ? undefined : quizType.value,
      );
      if (!data.guess || !data.compare) {
        throw new Error(i18n.global.t("single.incompleteResult"));
      }
      guessHistory.value = [...guessHistory.value, toHistoryRow(data.guess, data.compare)];
      if (data.limit) attemptsLimit.value = data.limit;
      const win = isWinningCompare(data.compare);
      if (win) {
        gameOver.value = true;
        answerVisible.value = true;
        resultStatus.value = "win";
        if (data.score) {
          earnedScore.value = data.score;
          await authStore.refreshPlayer().catch(() => undefined);
        }
      } else if (attemptsUsed.value >= attemptsLimit.value) {
        gameOver.value = true;
        answerVisible.value = true;
        resultStatus.value = "lost";
      }
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : i18n.global.t("single.submitFailed");
      throw reason;
    } finally {
      loading.value = false;
    }
  }

  function revealAnswer() {
    if (!target.value) return;
    answerVisible.value = true;
    gameOver.value = true;
    resultStatus.value = "revealed";
  }

  return {
    quizType,
    difficulty,
    target,
    guessHistory,
    loading,
    error,
    gameOver,
    answerVisible,
    resultStatus,
    attemptsLimit,
    attemptsUsed,
    attemptsLeft,
    canSubmit,
    earnedScore,
    setConfig,
    startGame,
    submitGuess,
    revealAnswer,
  };
});
