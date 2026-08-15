import type {
  CaptureMode,
  CaptureProgress,
  CaptureResult,
  ExtensionError,
  ImageFormat,
  PageMetrics,
  Rect,
} from "./types";

/**
 * Messages sent from popup/preview/history pages to the background service worker.
 * Settings, history metadata and image bytes are read/written directly from those pages via
 * `shared/storage` (chrome.storage / IndexedDB are available from any extension page) — the
 * background worker is only involved for actions that need a privileged API it alone can use:
 * orchestrating tab/content-script capture and chrome.downloads. Clipboard writes happen
 * directly from whichever page the user clicked "Copy" in (see `capture/image-processor.ts`'s
 * `copyBlobToClipboard`) since the Async Clipboard API requires a focused document, which only
 * a real, visible extension page — never a background worker — can be.
 */
export type UiRequest =
  | { type: "START_CAPTURE"; mode: CaptureMode }
  | { type: "CANCEL_CAPTURE" }
  | { type: "GET_PROGRESS" }
  | { type: "DOWNLOAD_CAPTURE"; id: string; format?: ImageFormat; quality?: number }
  | { type: "RECAPTURE"; mode: CaptureMode; sourceId?: string };

export interface UiResponseMap {
  START_CAPTURE: { started: true };
  CANCEL_CAPTURE: { cancelled: true };
  GET_PROGRESS: { progress: CaptureProgress };
  DOWNLOAD_CAPTURE: { filename: string };
  RECAPTURE: { started: true };
}

export type UiResult<T extends UiRequest["type"]> =
  | ({ ok: true } & UiResponseMap[T])
  | { ok: false; error: ExtensionError };

/** Messages sent from the background service worker to a page's content script. */
export type ContentRequest =
  | { type: "PING" }
  | { type: "ANALYZE_PAGE" }
  | { type: "PREPARE_CAPTURE"; hideSticky: boolean; scrollDelayMs: number; waitForLazyContent: boolean }
  | {
      type: "SCROLL_TO";
      y: number;
      isFirst: boolean;
      isLast: boolean;
      waitForLazyContent: boolean;
      scrollDelayMs: number;
    }
  | { type: "RESTORE_PAGE" }
  | { type: "START_SELECTION" }
  | { type: "CANCEL_SELECTION" };

export type ContentResponse =
  | { type: "PONG" }
  | { type: "PAGE_METRICS"; metrics: PageMetrics }
  | { type: "PREPARED"; metrics: PageMetrics }
  | { type: "SCROLL_RESULT"; actualY: number; documentHeight: number }
  | { type: "RESTORED" }
  | { type: "SELECTION_RESULT"; rect: Rect | null; devicePixelRatio: number };

/** Fire-and-forget broadcasts from the background worker to any listening UI surface. */
export type BackgroundBroadcast =
  | { type: "CAPTURE_PROGRESS"; progress: CaptureProgress }
  | { type: "CAPTURE_COMPLETE"; result: CaptureResult }
  | { type: "CAPTURE_FAILED"; error: ExtensionError };

function isChromeRuntimeError(): string | undefined {
  return chrome.runtime.lastError?.message;
}

/** Sends a request to the background service worker and awaits its typed response. */
export function sendToBackground<T extends UiRequest["type"]>(
  request: Extract<UiRequest, { type: T }>
): Promise<UiResult<T>> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(request, (response: UiResult<T> | undefined) => {
      const lastError = isChromeRuntimeError();
      if (lastError) {
        resolve({ ok: false, error: { code: "UNKNOWN", message: lastError } });
        return;
      }
      resolve(response ?? { ok: false, error: { code: "UNKNOWN", message: "No response" } });
    });
  });
}

/** Sends a request from the background worker to a specific tab's content script. */
export function sendToContentScript(
  tabId: number,
  request: ContentRequest,
  timeoutMs = 15000
): Promise<ContentResponse> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Content script did not respond in time"));
    }, timeoutMs);

    chrome.tabs.sendMessage(tabId, request, (response: ContentResponse | undefined) => {
      clearTimeout(timer);
      const lastError = isChromeRuntimeError();
      if (lastError) {
        reject(new Error(lastError));
        return;
      }
      if (!response) {
        reject(new Error("Content script returned an empty response"));
        return;
      }
      resolve(response);
    });
  });
}

export function broadcast(message: BackgroundBroadcast): void {
  chrome.runtime.sendMessage(message, () => {
    // No listener (e.g. popup closed) is expected and safe to ignore.
    void isChromeRuntimeError();
  });
}

export function onBroadcast(handler: (message: BackgroundBroadcast) => void): () => void {
  const listener = (message: unknown) => {
    if (isBackgroundBroadcast(message)) {
      handler(message);
    }
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}

function isBackgroundBroadcast(message: unknown): message is BackgroundBroadcast {
  if (!message || typeof message !== "object" || !("type" in message)) return false;
  const type = (message as { type: unknown }).type;
  return type === "CAPTURE_PROGRESS" || type === "CAPTURE_COMPLETE" || type === "CAPTURE_FAILED";
}
