import type { QuizType } from "./game";

export interface GlassHeaderProps {
  kicker: string;
  title: string;
  backTo: string;
  showThemeToggle?: boolean;
}

export interface ModalProps {
  /** Optional max-width override. Defaults to 400px. */
  maxWidth?: string;
}

export interface TabOption {
  key: string;
  label: string;
  icon?: string;
}

export interface TabGroupProps {
  tabs: TabOption[];
  activeKey: string;
}

export interface EmptyStateProps {
  icon?: string;
  title: string;
  description: string;
  kicker?: string;
}

export interface GameDockProps {
  label: string;
  meta: string;
  canSubmit: boolean;
  loading?: boolean;
  quizType: QuizType;
  placeholder?: string;
}

export interface AutocompleteNameEntry {
  name: string;
}
