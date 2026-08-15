import { MIN_CAPTURE_INTERVAL_MS } from "@shared/constants";
import type { ImageFormat } from "@shared/types";
import { dataUrlToArrayBuffer, sleep } from "@shared/utilities";

let lastCaptureAt = 0;

async function throttleToRateLimit(): Promise<void> {
  const elapsed = Date.now() - lastCaptureAt;
  if (elapsed < MIN_CAPTURE_INTERVAL_MS) {
    await sleep(MIN_CAPTURE_INTERVAL_MS - elapsed);
  }
}

/**
 * Captures the currently visible viewport of `windowId`. Chrome hard-limits
 * `captureVisibleTab` to a couple of calls per second — we throttle proactively and retry
 * with backoff on the rare occasion the limit is still hit (e.g. another extension also
 * capturing, or a very fast scroll loop).
 */
export async function captureVisibleViewport(
  windowId: number,
  format: ImageFormat,
  quality: number,
  maxRetries = 4
): Promise<{ buffer: ArrayBuffer; mimeType: string }> {
  const options: chrome.tabs.CaptureVisibleTabOptions =
    format === "jpeg" ? { format: "jpeg", quality } : { format: "png" };

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await throttleToRateLimit();
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(windowId, options);
      lastCaptureAt = Date.now();
      return dataUrlToArrayBuffer(dataUrl);
    } catch (error) {
      lastCaptureAt = Date.now();
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const isRateLimited = /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/i.test(message);
      if (isRateLimited && attempt < maxRetries) {
        await sleep(MIN_CAPTURE_INTERVAL_MS * (attempt + 2));
        continue;
      }
      throw error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to capture the visible tab after multiple attempts.");
}
