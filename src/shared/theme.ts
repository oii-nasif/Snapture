import type { ThemePreference } from "./types";

/** Applies a theme preference to the current document; "system" defers to prefers-color-scheme. */
export function applyTheme(theme: ThemePreference): void {
  const root = document.documentElement;
  if (theme === "system") {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = theme;
  }
}
