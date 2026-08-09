import { useLocalStorage } from "./useStorage";

export const SETTINGS_KEY = "phrolova_settings";

export interface AppSettings {
  /** 猜测记录渐入动画开关 */
  animations: boolean;
}

const settings = useLocalStorage<AppSettings>(SETTINGS_KEY, { animations: true });

export function useSettings() {
  function toggleAnimations() {
    settings.value = { ...settings.value, animations: !settings.value.animations };
  }

  function setAnimations(enabled: boolean) {
    settings.value = { ...settings.value, animations: enabled };
  }

  return { settings, toggleAnimations, setAnimations, SETTINGS_KEY };
}
