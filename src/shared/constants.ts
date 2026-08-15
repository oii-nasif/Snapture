import type { ExtensionSettings } from "./types";

export const DEFAULT_SETTINGS: ExtensionSettings = {
  capture: {
    scrollDelayMs: 500,
    scrollOverlapPx: 24,
    hideStickyElements: true,
    waitForLazyContent: true,
    maxPageHeightPx: 30000,
    maxCaptureDurationMs: 60000,
  },
  output: {
    format: "png",
    jpegQuality: 90,
    filenamePrefix: "screenshot",
  },
  history: {
    enabled: true,
    maxItems: 25,
  },
  appearance: {
    theme: "system",
  },
};

export const HISTORY_LIMIT_OPTIONS = [10, 25, 50, 100] as const;

/** Chrome throttles captureVisibleTab; staying under this keeps us out of the rate-limit error. */
export const MAX_CAPTURES_PER_SECOND = 2;
export const MIN_CAPTURE_INTERVAL_MS = Math.ceil(1000 / MAX_CAPTURES_PER_SECOND) + 50;

/** Browser-enforced practical ceiling for a single 2D canvas dimension (varies by platform; kept conservative). */
export const MAX_CANVAS_DIMENSION_PX = 32000;
export const MAX_CANVAS_AREA_PX = 268_000_000; // ~16384^2, conservative shared limit across browsers

export const STORAGE_KEYS = {
  settings: "settings",
  history: "history",
} as const;

export const IMAGE_DB_NAME = "snapture-images";
export const IMAGE_DB_STORE = "images";
export const IMAGE_DB_VERSION = 1;

export const RESTRICTED_URL_PREFIXES = [
  "chrome://",
  "chrome-extension://",
  "chrome-untrusted://",
  "edge://",
  "about:",
  "devtools://",
  "view-source:",
  "https://chrome.google.com/webstore",
  "https://chromewebstore.google.com",
];

export const KEYBOARD_COMMANDS = {
  captureFullPage: "capture-full-page",
  captureVisible: "capture-visible",
  captureSelection: "capture-selection",
} as const;
