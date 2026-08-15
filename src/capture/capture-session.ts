import { extendScrollPlanForGrowth, computeScrollSteps, type ScrollStep } from "../content/scroll-math";
import { sendToContentScript } from "@shared/messaging";
import type { CaptureProgress, CaptureSettings, ImageFormat, OutputSettings, PageMetrics, Rect } from "@shared/types";
import { cropImage, getImageDimensions, type EncodedImage } from "./image-processor";
import { stitchFrames, type StitchInputFrame } from "./screenshot-stitcher";
import { captureVisibleViewport } from "./viewport-capture";

export class CaptureCancelledError extends Error {
  constructor() {
    super("Capture was cancelled.");
    this.name = "CaptureCancelledError";
  }
}

export interface CaptureCallbacks {
  onProgress: (progress: CaptureProgress) => void;
  isCancelled: () => boolean;
}

const CONTENT_SCRIPT_FILE = "content/content-bundle.js";

async function ensureContentScriptInjected(tabId: number): Promise<void> {
  try {
    await sendToContentScript(tabId, { type: "PING" }, 300);
    return;
  } catch {
    // Not yet injected (or a previous instance died with the page) — inject fresh.
  }
  await chrome.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT_FILE] });
  await sendToContentScript(tabId, { type: "PING" }, 2000);
}

function throwIfCancelled(callbacks: CaptureCallbacks): void {
  if (callbacks.isCancelled()) throw new CaptureCancelledError();
}

/**
 * Runs the full top-to-bottom capture pipeline: prepare the page, iteratively scroll and
 * capture each viewport (extending the plan live if lazy content grows the page, and bailing
 * out if the browser stops making scroll progress), restore the page exactly as it was
 * (even on failure/cancellation), then stitch every frame into one image.
 */
export async function captureFullPage(
  tab: chrome.tabs.Tab,
  settings: CaptureSettings,
  output: OutputSettings,
  callbacks: CaptureCallbacks
): Promise<EncodedImage> {
  const tabId = tab.id;
  const windowId = tab.windowId;
  if (tabId === undefined || windowId === undefined) {
    throw new Error("The active tab could not be identified.");
  }

  await ensureContentScriptInjected(tabId);

  callbacks.onProgress({
    status: "preparing",
    mode: "full-page",
    current: 0,
    total: 0,
    message: "Analyzing page…",
  });

  const prepared = await sendToContentScript(
    tabId,
    {
      type: "PREPARE_CAPTURE",
      hideSticky: settings.hideStickyElements,
      scrollDelayMs: settings.scrollDelayMs,
      waitForLazyContent: settings.waitForLazyContent,
    },
    Math.max(15000, settings.scrollDelayMs * 3 + 5000)
  );
  if (prepared.type !== "PREPARED") {
    throw new Error("The page did not respond correctly while preparing for capture.");
  }

  const metrics: PageMetrics = prepared.metrics;
  const cappedDocHeight = Math.min(metrics.documentHeight, settings.maxPageHeightPx);
  let steps: ScrollStep[] = computeScrollSteps(
    cappedDocHeight,
    metrics.viewportHeight,
    settings.scrollOverlapPx
  );

  const frames: StitchInputFrame[] = [];
  const deadline = Date.now() + settings.maxCaptureDurationMs;
  let previousActualY: number | null = null;
  let effectiveDocHeight = cappedDocHeight;

  try {
    let index = 0;
    while (index < steps.length) {
      throwIfCancelled(callbacks);

      const step = steps[index];
      if (!step) break;
      if (Date.now() > deadline) {
        // Out of time: stitch whatever was captured rather than failing the whole capture.
        break;
      }

      callbacks.onProgress({
        status: "capturing",
        mode: "full-page",
        current: index + 1,
        total: steps.length,
        message: `Capturing section ${index + 1} of ${steps.length}…`,
      });

      const scrollResponse = await sendToContentScript(tabId, {
        type: "SCROLL_TO",
        y: step.y,
        isFirst: step.isFirst,
        isLast: step.isLast,
        waitForLazyContent: settings.waitForLazyContent,
        scrollDelayMs: settings.scrollDelayMs,
      });
      if (scrollResponse.type !== "SCROLL_RESULT") {
        throw new Error("The page did not respond correctly while scrolling.");
      }

      const noProgress = previousActualY !== null && scrollResponse.actualY === previousActualY;
      previousActualY = scrollResponse.actualY;

      // The page grew (lazy content appended below the fold) — extend the plan live.
      if (step.isLast && scrollResponse.documentHeight > effectiveDocHeight + 4 && !noProgress) {
        effectiveDocHeight = Math.min(scrollResponse.documentHeight, settings.maxPageHeightPx);
        const extension = extendScrollPlanForGrowth(
          scrollResponse.actualY,
          scrollResponse.documentHeight,
          metrics.viewportHeight,
          settings.scrollOverlapPx,
          settings.maxPageHeightPx
        );
        steps = [...steps.slice(0, index), { ...step, isLast: false }, ...extension.slice(1)];
      }

      const captured = await captureVisibleViewport(windowId, "png", 100);
      frames.push({
        actualY: scrollResponse.actualY,
        ...(metrics.needsCrop
          ? await cropImage(
              captured.buffer,
              captured.mimeType,
              {
                x: metrics.captureOffsetX,
                y: metrics.captureOffsetY,
                width: metrics.viewportWidth,
                height: metrics.viewportHeight,
              },
              metrics.devicePixelRatio,
              "png",
              100
            )
          : captured),
      });

      if (noProgress) break; // Browser can't scroll further than this — treat as the bottom.
      index++;
    }
  } finally {
    await sendToContentScript(tabId, { type: "RESTORE_PAGE" }).catch(() => undefined);
  }

  callbacks.onProgress({
    status: "stitching",
    mode: "full-page",
    current: 0,
    total: frames.length,
    message: "Stitching sections together…",
  });

  return stitchFrames(
    frames,
    metrics.viewportWidth,
    metrics.viewportHeight,
    effectiveDocHeight,
    metrics.devicePixelRatio,
    output.format,
    output.jpegQuality,
    (drawn, total) =>
      callbacks.onProgress({
        status: "stitching",
        mode: "full-page",
        current: drawn,
        total,
        message: `Stitching section ${drawn} of ${total}…`,
      })
  );
}

/** Captures just the current viewport — a single API call, near-instant. */
export async function captureVisible(
  tab: chrome.tabs.Tab,
  output: OutputSettings
): Promise<EncodedImage> {
  const windowId = tab.windowId;
  if (windowId === undefined) throw new Error("The active tab could not be identified.");

  const { buffer, mimeType } = await captureVisibleViewport(windowId, output.format, output.jpegQuality);
  const { width, height } = await getImageDimensions(buffer, mimeType);
  return { buffer, mimeType, width, height };
}

/** Lets the user drag-select a region of the viewport, then captures and crops just that area. */
export async function captureSelection(
  tab: chrome.tabs.Tab,
  output: OutputSettings,
  callbacks: CaptureCallbacks
): Promise<EncodedImage> {
  const tabId = tab.id;
  const windowId = tab.windowId;
  if (tabId === undefined || windowId === undefined) {
    throw new Error("The active tab could not be identified.");
  }

  await ensureContentScriptInjected(tabId);

  callbacks.onProgress({
    status: "preparing",
    mode: "selection",
    current: 0,
    total: 1,
    message: "Drag to select an area…",
  });

  const selectionResponse = await sendToContentScript(tabId, { type: "START_SELECTION" }, 5 * 60 * 1000);
  if (selectionResponse.type !== "SELECTION_RESULT") {
    throw new Error("The page did not respond correctly during area selection.");
  }
  throwIfCancelled(callbacks);
  if (!selectionResponse.rect) {
    throw new CaptureCancelledError();
  }

  callbacks.onProgress({
    status: "capturing",
    mode: "selection",
    current: 1,
    total: 1,
    message: "Capturing selected area…",
  });

  const captured = await captureVisibleViewport(windowId, "png", 100);
  return cropImage(
    captured.buffer,
    captured.mimeType,
    selectionResponse.rect as Rect,
    selectionResponse.devicePixelRatio,
    output.format,
    output.jpegQuality
  );
}

export function isSupportedFormat(format: string): format is ImageFormat {
  return format === "png" || format === "jpeg";
}
