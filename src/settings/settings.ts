import { clearHistory, getSettings, saveSettings } from "@shared/storage";
import { applyTheme } from "@shared/theme";
import type { ExtensionSettings, ImageFormat, ThemePreference } from "@shared/types";

const saveIndicator = document.getElementById("saveIndicator") as HTMLParagraphElement;

const scrollDelay = document.getElementById("scrollDelay") as HTMLInputElement;
const scrollDelayValue = document.getElementById("scrollDelayValue") as HTMLSpanElement;
const scrollOverlap = document.getElementById("scrollOverlap") as HTMLInputElement;
const scrollOverlapValue = document.getElementById("scrollOverlapValue") as HTMLSpanElement;
const hideSticky = document.getElementById("hideSticky") as HTMLInputElement;
const waitForLazy = document.getElementById("waitForLazy") as HTMLInputElement;
const maxPageHeight = document.getElementById("maxPageHeight") as HTMLInputElement;
const maxPageHeightValue = document.getElementById("maxPageHeightValue") as HTMLSpanElement;
const maxDuration = document.getElementById("maxDuration") as HTMLInputElement;
const maxDurationValue = document.getElementById("maxDurationValue") as HTMLSpanElement;

const outputFormat = document.getElementById("outputFormat") as HTMLSelectElement;
const jpegQuality = document.getElementById("jpegQuality") as HTMLInputElement;
const jpegQualityValue = document.getElementById("jpegQualityValue") as HTMLSpanElement;
const filenamePrefix = document.getElementById("filenamePrefix") as HTMLInputElement;

const historyEnabled = document.getElementById("historyEnabled") as HTMLInputElement;
const historyLimit = document.getElementById("historyLimit") as HTMLSelectElement;
const clearHistoryBtn = document.getElementById("clearHistoryBtn") as HTMLButtonElement;

const themeSegmented = document.getElementById("themeSegmented") as HTMLDivElement;

let settings: ExtensionSettings;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function readFormIntoSettings(): ExtensionSettings {
  return {
    capture: {
      scrollDelayMs: Number(scrollDelay.value),
      scrollOverlapPx: Number(scrollOverlap.value),
      hideStickyElements: hideSticky.checked,
      waitForLazyContent: waitForLazy.checked,
      maxPageHeightPx: Number(maxPageHeight.value),
      maxCaptureDurationMs: Number(maxDuration.value) * 1000,
    },
    output: {
      format: outputFormat.value as ImageFormat,
      jpegQuality: Number(jpegQuality.value),
      filenamePrefix: filenamePrefix.value.trim() || "screenshot",
    },
    history: {
      enabled: historyEnabled.checked,
      maxItems: Number(historyLimit.value),
    },
    appearance: settings.appearance,
  };
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    settings = readFormIntoSettings();
    await saveSettings(settings);
    saveIndicator.textContent = "Saved";
    setTimeout(() => {
      if (saveIndicator.textContent === "Saved") saveIndicator.textContent = "";
    }, 1500);
  }, 250);
}

function populateForm(current: ExtensionSettings): void {
  scrollDelay.value = String(current.capture.scrollDelayMs);
  scrollDelayValue.textContent = String(current.capture.scrollDelayMs);
  scrollOverlap.value = String(current.capture.scrollOverlapPx);
  scrollOverlapValue.textContent = String(current.capture.scrollOverlapPx);
  hideSticky.checked = current.capture.hideStickyElements;
  waitForLazy.checked = current.capture.waitForLazyContent;
  maxPageHeight.value = String(current.capture.maxPageHeightPx);
  maxPageHeightValue.textContent = String(current.capture.maxPageHeightPx);
  maxDuration.value = String(Math.round(current.capture.maxCaptureDurationMs / 1000));
  maxDurationValue.textContent = maxDuration.value;

  outputFormat.value = current.output.format;
  jpegQuality.value = String(current.output.jpegQuality);
  jpegQualityValue.textContent = String(current.output.jpegQuality);
  filenamePrefix.value = current.output.filenamePrefix;

  historyEnabled.checked = current.history.enabled;
  historyLimit.value = String(current.history.maxItems);

  setActiveTheme(current.appearance.theme);
}

function setActiveTheme(theme: ThemePreference): void {
  themeSegmented.querySelectorAll<HTMLButtonElement>(".segmented-option").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.value === theme));
  });
}

function wireLiveLabels(): void {
  scrollDelay.addEventListener("input", () => (scrollDelayValue.textContent = scrollDelay.value));
  scrollOverlap.addEventListener("input", () => (scrollOverlapValue.textContent = scrollOverlap.value));
  maxPageHeight.addEventListener("input", () => (maxPageHeightValue.textContent = maxPageHeight.value));
  maxDuration.addEventListener("input", () => (maxDurationValue.textContent = maxDuration.value));
  jpegQuality.addEventListener("input", () => (jpegQualityValue.textContent = jpegQuality.value));
}

function wireSaveTriggers(): void {
  const inputs = [
    scrollDelay,
    scrollOverlap,
    hideSticky,
    waitForLazy,
    maxPageHeight,
    maxDuration,
    outputFormat,
    jpegQuality,
    filenamePrefix,
    historyEnabled,
    historyLimit,
  ];
  inputs.forEach((input) => {
    input.addEventListener("input", scheduleSave);
    input.addEventListener("change", scheduleSave);
  });
}

themeSegmented.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".segmented-option");
  if (!button?.dataset.value) return;
  const theme = button.dataset.value as ThemePreference;
  setActiveTheme(theme);
  applyTheme(theme);
  settings = { ...settings, appearance: { theme } };
  void saveSettings(settings).then(() => {
    saveIndicator.textContent = "Saved";
    setTimeout(() => {
      if (saveIndicator.textContent === "Saved") saveIndicator.textContent = "";
    }, 1500);
  });
});

clearHistoryBtn.addEventListener("click", async () => {
  if (!window.confirm("Delete all screenshot history? This cannot be undone.")) return;
  await clearHistory();
  saveIndicator.textContent = "History cleared";
});

async function init(): Promise<void> {
  settings = await getSettings();
  applyTheme(settings.appearance.theme);
  populateForm(settings);
  wireLiveLabels();
  wireSaveTriggers();
}

void init();
