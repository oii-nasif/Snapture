/** Core domain types shared across every extension surface. */

export type CaptureMode = "full-page" | "visible" | "selection";

export type CaptureStatus =
  | "idle"
  | "preparing"
  | "capturing"
  | "stitching"
  | "complete"
  | "failed"
  | "cancelled";

export interface CaptureProgress {
  status: CaptureStatus;
  mode: CaptureMode | null;
  current: number;
  total: number;
  message: string;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PageMetrics {
  /** Width/height of the region that actually scrolls — the whole viewport on ordinary pages,
   *  or a single inner scrollable container's on-screen size on apps that scroll one internally
   *  (Confluence, Notion, many dashboards). */
  viewportWidth: number;
  viewportHeight: number;
  /** scrollWidth/scrollHeight of whichever element is actually scrolling. */
  documentWidth: number;
  documentHeight: number;
  scrollX: number;
  scrollY: number;
  devicePixelRatio: number;
  /** Offset (CSS px) of the scrollable region within the full browser viewport. Zero on
   *  ordinary pages; nonzero when it's an inner container that doesn't fill the window. */
  captureOffsetX: number;
  captureOffsetY: number;
  /** True when captured frames must be cropped to (captureOffsetX/Y, viewportWidth/Height)
   *  before stitching, because the scrollable region isn't the full browser viewport. */
  needsCrop: boolean;
}

export type ImageFormat = "png" | "jpeg";

export interface OutputSettings {
  format: ImageFormat;
  jpegQuality: number;
  filenamePrefix: string;
}

export interface CaptureSettings {
  scrollDelayMs: number;
  scrollOverlapPx: number;
  hideStickyElements: boolean;
  waitForLazyContent: boolean;
  maxPageHeightPx: number;
  maxCaptureDurationMs: number;
}

export interface HistorySettings {
  enabled: boolean;
  maxItems: number;
}

export type ThemePreference = "system" | "light" | "dark";

export interface AppearanceSettings {
  theme: ThemePreference;
}

export interface ExtensionSettings {
  capture: CaptureSettings;
  output: OutputSettings;
  history: HistorySettings;
  appearance: AppearanceSettings;
}

export interface HistoryEntry {
  id: string;
  createdAt: number;
  mode: CaptureMode;
  pageTitle: string;
  pageUrl: string;
  width: number;
  height: number;
  sizeBytes: number;
  format: ImageFormat;
  thumbnailDataUrl: string;
}

export interface CaptureResult {
  id: string;
  mode: CaptureMode;
  width: number;
  height: number;
  format: ImageFormat;
  sizeBytes: number;
  pageTitle: string;
  pageUrl: string;
  createdAt: number;
}

export type ExtensionErrorCode =
  | "RESTRICTED_PAGE"
  | "UNSUPPORTED_PAGE"
  | "CAPTURE_TIMEOUT"
  | "CANVAS_LIMIT_EXCEEDED"
  | "CLIPBOARD_UNAVAILABLE"
  | "DOWNLOAD_FAILED"
  | "TAB_NAVIGATED"
  | "CAPTURE_RATE_LIMIT"
  | "CONTENT_SCRIPT_UNREACHABLE"
  | "SELECTION_CANCELLED"
  | "CANCELLED"
  | "NOT_FOUND"
  | "UNKNOWN";

export interface ExtensionError {
  code: ExtensionErrorCode;
  message: string;
}
