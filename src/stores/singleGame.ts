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
  const resultMessage = shallowRef("");
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
    resultMessage.value = "";
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
      error.value = reason instanceof Error ? reason.message : "开局失败";
      throw reason;
    } finally {
      loading.value = false;
    }
  }

  async function submitGuess(guessName: string) {
    if (!guessName.trim()) {
      throw new Error("请输入角色或声骸名称");
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
        throw new Error("返回结果不完整");
      }
      guessHistory.value = [...guessHistory.value, toHistoryRow(data.guess, data.compare)];
      if (data.limit) attemptsLimit.value = data.limit;
      const win = isWinningCompare(data.compare);
      if (win) {
        gameOver.value = true;
        answerVisible.value = true;
        resultMessage.value = "回答正确，本局已完成。";
        if (data.score) {
          earnedScore.value = data.score;
          await authStore.refreshPlayer().catch(() => undefined);
        }
      } else if (attemptsUsed.value >= attemptsLimit.value) {
        gameOver.value = true;
        answerVisible.value = true;
        resultMessage.value = "机会已用尽，可以重新开始。";
      }
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : "提交猜测失败";
      throw reason;
    } finally {
      loading.value = false;
    }
  }

  function revealAnswer() {
    if (!target.value) return;
    answerVisible.value = true;
    gameOver.value = true;
    resultMessage.value = "已显示本局答案。";
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
    resultMessage,
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
