<script setup lang="ts">
import { computed, onMounted, ref, watch, watchEffect } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";

import ModalOverlay from "@/components/shared/ModalOverlay.vue";
import { useAuthStore } from "@/stores/auth";
import { useMultiGameStore } from "@/stores/multiGame";
import { useTheme } from "@/composables/useTheme";
import { useSettings } from "@/composables/useSettings";
import { useLocalStorage } from "@/composables/useStorage";
import { useLocale } from "@/i18n";
import type { AccentPreset } from "@/types";

const ACCENT_KEY = "phrolova_accent";

const authStore = useAuthStore();
const multiGameStore = useMultiGameStore();
const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const { locale, setLocale, availableLocales } = useLocale();
const { theme, toggleTheme } = useTheme();
const { settings, toggleAnimations } = useSettings();

const isHomeRoute = computed(() => route.name === "home");
const isGameRoute = computed(() => {
  const name = route.name;
  return name === "single" || name === "single-play" || name === "multi-lobby" || name === "multi-room";
});
const isAdminLoginRoute = computed(() => route.name === "admin-login");
const isAdminRoute = computed(() => isAdminLoginRoute.value || route.name === "admin-diff" || route.name === "admin-table" || route.name === "admin-acknowledgements");

const ACCENTS: AccentPreset[] = [
  {
    id: "violet", label: "theme.violet",
    dark: { gold: "#a78bfa", goldSoft: "rgba(167,139,250,0.45)", shellBg: "#0a0810", shellBgDeep: "#120e1c", surfacePanel: "rgba(22,18,34,0.94)", surfacePanelStrong: "rgba(28,22,42,0.96)", surfaceCard: "rgba(20,16,30,0.96)", textMain: "#f5f0fa", textSub: "#a599c5", textFaint: "rgba(165,153,197,0.60)" },
    light: { gold: "#7c5cc4", goldSoft: "rgba(124,92,196,0.35)", shellBg: "#f3f0f8", shellBgDeep: "#e8e2f2", surfacePanel: "rgba(252,250,255,0.94)", surfacePanelStrong: "rgba(250,246,255,0.96)", surfaceCard: "rgba(250,246,255,0.96)", textMain: "#241a33", textSub: "#5e4d7a", textFaint: "rgba(94,77,122,0.55)" },
  },
  {
    id: "gold", label: "theme.gold",
    dark: { gold: "#e6b84d", goldSoft: "rgba(230,184,77,0.45)", shellBg: "#080806", shellBgDeep: "#0f0e0a", surfacePanel: "rgba(22,20,14,0.94)", surfacePanelStrong: "rgba(28,25,18,0.96)", surfaceCard: "rgba(20,18,13,0.96)", textMain: "#faf8f0", textSub: "#b5ad90", textFaint: "rgba(181,173,144,0.60)" },
    light: { gold: "#b8922e", goldSoft: "rgba(184,146,46,0.35)", shellBg: "#f5f2e8", shellBgDeep: "#ede8d8", surfacePanel: "rgba(255,252,242,0.94)", surfacePanelStrong: "rgba(252,248,232,0.96)", surfaceCard: "rgba(250,246,230,0.96)", textMain: "#2a2416", textSub: "#6b6040", textFaint: "rgba(107,96,64,0.55)" },
  },
  {
    id: "cyan", label: "theme.cyan",
    dark: { gold: "#22d3ee", goldSoft: "rgba(34,211,238,0.45)", shellBg: "#041012", shellBgDeep: "#08181c", surfacePanel: "rgba(14,28,32,0.94)", surfacePanelStrong: "rgba(18,36,42,0.96)", surfaceCard: "rgba(12,24,28,0.96)", textMain: "#eafafc", textSub: "#8db8c4", textFaint: "rgba(141,184,196,0.60)" },
    light: { gold: "#0891b2", goldSoft: "rgba(8,145,178,0.35)", shellBg: "#eff8fa", shellBgDeep: "#dcf0f4", surfacePanel: "rgba(248,252,254,0.94)", surfacePanelStrong: "rgba(242,250,252,0.96)", surfaceCard: "rgba(244,250,252,0.96)", textMain: "#0a2228", textSub: "#3a6878", textFaint: "rgba(58,104,120,0.55)" },
  },
  {
    id: "rose", label: "theme.rose",
    dark: { gold: "#fb7185", goldSoft: "rgba(251,113,133,0.45)", shellBg: "#100408", shellBgDeep: "#1c0a10", surfacePanel: "rgba(34,14,20,0.94)", surfacePanelStrong: "rgba(42,18,26,0.96)", surfaceCard: "rgba(30,12,18,0.96)", textMain: "#fdf0f2", textSub: "#c89099", textFaint: "rgba(200,144,153,0.60)" },
    light: { gold: "#e11d48", goldSoft: "rgba(225,29,72,0.35)", shellBg: "#faf0f2", shellBgDeep: "#f4dde2", surfacePanel: "rgba(255,248,250,0.94)", surfacePanelStrong: "rgba(252,242,246,0.96)", surfaceCard: "rgba(252,244,246,0.96)", textMain: "#280812", textSub: "#78304a", textFaint: "rgba(120,48,74,0.55)" },
  },
  {
    id: "emerald", label: "theme.emerald",
    dark: { gold: "#4ade80", goldSoft: "rgba(74,222,128,0.45)", shellBg: "#041008", shellBgDeep: "#081a10", surfacePanel: "rgba(14,30,20,0.94)", surfacePanelStrong: "rgba(18,38,24,0.96)", surfaceCard: "rgba(12,26,18,0.96)", textMain: "#eafdf0", textSub: "#88c89c", textFaint: "rgba(136,200,156,0.60)" },
    light: { gold: "#16a34a", goldSoft: "rgba(22,163,74,0.35)", shellBg: "#effaf2", shellBgDeep: "#dcf2e2", surfacePanel: "rgba(248,254,250,0.94)", surfacePanelStrong: "rgba(242,252,246,0.96)", surfaceCard: "rgba(244,252,248,0.96)", textMain: "#082014", textSub: "#306050", textFaint: "rgba(48,96,80,0.55)" },
  },
  {
    id: "amber", label: "theme.amber",
    dark: { gold: "#fbbf24", goldSoft: "rgba(251,191,36,0.45)", shellBg: "#100c04", shellBgDeep: "#1a1408", surfacePanel: "rgba(30,24,14,0.94)", surfacePanelStrong: "rgba(38,30,18,0.96)", surfaceCard: "rgba(26,20,12,0.96)", textMain: "#fdf6e8", textSub: "#c4ac78", textFaint: "rgba(196,172,120,0.60)" },
    light: { gold: "#d97706", goldSoft: "rgba(217,119,6,0.35)", shellBg: "#faf6ee", shellBgDeep: "#f2e8d4", surfacePanel: "rgba(255,252,244,0.94)", surfacePanelStrong: "rgba(252,248,236,0.96)", surfaceCard: "rgba(250,246,234,0.96)", textMain: "#241604", textSub: "#6a4e18", textFaint: "rgba(106,78,24,0.55)" },
  },
];

const accentId = useLocalStorage(ACCENT_KEY, "violet");
const showAccentPicker = ref(false);
const showSettingsModal = ref(false);

// Reactive accent color application — runs whenever theme or accentId changes
const ACCENT_PROPS = ["gold","goldSoft","shellBg","shellBgDeep","surfacePanel","surfacePanelStrong","surfaceCard","textMain","textSub","textFaint"] as const;

watchEffect(() => {
  const preset = ACCENTS.find(a => a.id === accentId.value) || ACCENTS[0];
  const colors = theme.value === "phrolova-night" ? preset.dark : preset.light;
  const root = document.documentElement;
  for (const prop of ACCENT_PROPS) {
    root.style.setProperty(`--${toKebab(prop)}`, colors[prop]);
  }
});

function toKebab(camel: string): string {
  return camel.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

function selectAccent(id: string) {
  accentId.value = id;
  showAccentPicker.value = false;
}

function handleLogout() {
  multiGameStore.disconnect();
  authStore.logout();
  router.push("/");
}

function handleKickedConfirm() {
  authStore.logout();
  multiGameStore.kicked = false;
  router.push("/");
}

watch(
  () => multiGameStore.roomState?.roomCode,
  (roomCode) => {
    if (roomCode && route.name !== "multi-room") {
      router.push("/multi/room");
    }
  },
);

onMounted(async () => {
  await authStore.hydrate();
  if (authStore.isAuthenticated) {
    await multiGameStore.resumeRoom().catch(() => undefined);
  }
});
</script>

<template>
  <div class="app-root">
    <main class="app-main" :class="{ 'app-main-home': isHomeRoute, 'app-main-game': isGameRoute, 'app-main-admin': isAdminRoute }">
      <RouterView />
    </main>

    <ModalOverlay v-if="multiGameStore.kicked" max-width="360px" panel-class="kicked-modal" no-close @close="handleKickedConfirm">
      <Icon icon="ph:warning-duotone" class="kicked-icon" />
      <h2 class="kicked-title">{{ t('auth.kickedTitle') }}</h2>
      <p class="kicked-desc">{{ t('auth.kickedDesc') }}</p>
      <button class="kicked-btn" @click="handleKickedConfirm">{{ t('common.confirm') }}</button>
    </ModalOverlay>

    <div v-if="isHomeRoute" class="theme-controls">
      <button class="theme-toggle" type="button" @click="toggleTheme"
        :aria-label="theme === 'phrolova-light' ? t('settings.toggleDark') : t('settings.toggleLight')">
        <Icon :icon="theme === 'phrolova-light' ? 'ph:moon-duotone' : 'ph:sun-duotone'" />
      </button>
      <button class="theme-accent-btn" type="button" @click="showAccentPicker = !showAccentPicker"
        :aria-label="t('settings.accent')">
        <Icon icon="ph:palette-duotone" />
        <span class="theme-accent-dot" :style="{ background: 'var(--gold)' }" />
      </button>
      <button class="theme-settings-btn" type="button" @click="showSettingsModal = true"
        :aria-label="t('settings.title')">
        <Icon icon="ph:gear-six-duotone" />
      </button>
      <Transition name="accent-pop">
        <div v-if="showAccentPicker" class="accent-picker">
          <p class="accent-picker-title">{{ t('settings.accent') }}</p>
          <div class="accent-grid">
            <button
              v-for="accent in ACCENTS"
              :key="accent.id"
              class="accent-swatch"
              :class="{ 'accent-swatch--active': accentId === accent.id }"
              :style="{ '--swatch-color': theme === 'phrolova-night' ? accent.dark.gold : accent.light.gold }"
              @click="selectAccent(accent.id)"
            >
              <span class="accent-swatch-dot" />
              <span class="accent-swatch-label">{{ t(accent.label) }}</span>
            </button>
          </div>
        </div>
      </Transition>
    </div>

    <ModalOverlay v-if="showSettingsModal" panel-class="settings-modal" max-width="400px" @close="showSettingsModal = false">
      <header class="settings-modal-header">
        <p class="settings-modal-kicker">{{ t('settings.kicker') }}</p>
        <h2 class="settings-modal-title">{{ t('settings.title') }}</h2>
      </header>
      <div class="settings-modal-body">
        <div class="settings-row">
          <div class="settings-row-info">
            <span class="settings-row-label">{{ t('settings.animations') }}</span>
            <span class="settings-row-desc">{{ t('settings.animationsDesc') }}</span>
          </div>
          <button
            class="settings-switch"
            :class="{ 'settings-switch--on': settings.animations }"
            type="button"
            role="switch"
            :aria-checked="settings.animations"
            @click="toggleAnimations"
          >
            <span class="settings-switch-thumb" />
          </button>
        </div>
        <div class="settings-row">
          <div class="settings-row-info">
            <span class="settings-row-label">{{ t('settings.language') }}</span>
          </div>
          <div class="settings-lang-options">
            <button
              v-for="loc in availableLocales"
              :key="loc.value"
              class="settings-lang-btn"
              :class="{ 'settings-lang-btn--active': locale === loc.value }"
              type="button"
              @click="setLocale(loc.value)"
            >
              {{ loc.label }}
            </button>
          </div>
        </div>
      </div>
    </ModalOverlay>
  </div>
</template>

