import { reactive, ref, shallowRef } from "vue";
import { defineStore } from "pinia";

import type { QuizType, ResonatorNameEntry, SkeletonNameEntry } from "@/types/game";
import * as api from "@/api";

export const useDictionaryStore = defineStore("dictionary", () => {
  const resonatorNames = ref<ResonatorNameEntry[]>([]);
  const skeletonNames = ref<SkeletonNameEntry[]>([]);
  const loaded = reactive({
    resonator: false,
    skeleton: false,
  });
  const loading = shallowRef(false);
  const error = shallowRef("");

  async function loadResonatorNames() {
    if (loaded.resonator) return;
    loading.value = true;
    try {
      const data = await api.fetchResonatorNames();
      resonatorNames.value = data.names;
      loaded.resonator = true;
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : "加载共鸣者列表失败";
      throw reason;
    } finally {
      loading.value = false;
    }
  }

  async function loadSkeletonNames() {
    if (loaded.skeleton) return;
    loading.value = true;
    try {
      const data = await api.fetchSkeletonNames();
      skeletonNames.value = data.names;
      loaded.skeleton = true;
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : "加载声骸列表失败";
      throw reason;
    } finally {
      loading.value = false;
    }
  }

  async function ensureLoaded(quizType: QuizType) {
    if (quizType === "skeleton") {
      await loadSkeletonNames();
    } else {
      await loadResonatorNames();
    }
  }

  return {
    resonatorNames,
    skeletonNames,
    loaded,
    loading,
    error,
    ensureLoaded,
    loadResonatorNames,
    loadSkeletonNames,
  };
});
