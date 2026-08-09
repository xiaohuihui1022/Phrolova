import { watchEffect } from "vue";
import type { Theme } from "@/types";
import { useLocalStorage } from "./useStorage";

export const THEME_KEY = "phrolova_theme";

const theme = useLocalStorage<Theme>(THEME_KEY, "phrolova-light");

// Reactive side-effect: syncs data-theme attribute on <html> whenever theme changes
watchEffect(() => {
  document.documentElement.setAttribute("data-theme", theme.value);
});

export function useTheme() {
  function applyTheme(next: Theme) {
    theme.value = next;
  }

  function toggleTheme() {
    theme.value = theme.value === "phrolova-light" ? "phrolova-night" : "phrolova-light";
  }

  return { theme, toggleTheme, applyTheme, THEME_KEY };
}
