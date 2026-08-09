export type Theme = "phrolova-light" | "phrolova-night";

export interface AccentColorSet {
  gold: string;
  goldSoft: string;
  shellBg: string;
  shellBgDeep: string;
  surfacePanel: string;
  surfacePanelStrong: string;
  surfaceCard: string;
  textMain: string;
  textSub: string;
  textFaint: string;
}

export interface AccentPreset {
  id: string;
  label: string;
  dark: AccentColorSet;
  light: AccentColorSet;
}
