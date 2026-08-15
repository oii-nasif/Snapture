import {
  captureFullPage,
  captureSelection,
  captureVisible,
  CaptureCancelledError,
} from "@capture/capture-session";
import {
  createThumbnailDataUrl,
  cropImage,
  getImageDimensions,
  type EncodedImage,
} from "@capture/image-processor";
import { KEYBOARD_COMMANDS } from "@shared/constants";
import { broadcast, type UiRequest, type UiResult } from "@shared/messaging";
import {
  addHistoryEntry,
  deleteImageBlob,
  getImageBlob,
  getSettings,
  saveImageBlob,
} from "@shared/storage";
import type { CaptureMode, CaptureProgress, CaptureResult, ExtensionError, ExtensionErrorCode, ImageFormat } from "@shared/types";
import { formatTimestampForFilename, generateId, isRestrictedUrl } from "@shared/utilities";

interface CaptureState {
  busy: boolean;
  cancelRequested: boolean;
  progress: CaptureProgress;
}

const captureState: CaptureState = {
  busy: false,
  cancelRequested: false,
  progress: { status: "idle", mode: null, current: 0, total: 0, message: "" },
};

/** Best-effort id → source tab mapping so "Recapture" can re-target the original page. */
const sourceTabByCaptureId = new Map<string, number>();

chrome.runtime.onMessage.addListener((message: UiRequest, _sender, sendResponse) => {
  handleUiRequest(message)
    .then(sendResponse)
    .catch((error: unknown) => sendResponse({ ok: false, error: toExtensionError(error) }));
  return true;
});

chrome.commands.onCommand.addListener((command) => {
  const mode = modeForCommand(command);
  if (mode) void startCapture(mode);
});

function modeForCommand(command: string): CaptureMode | null {
  switch (command) {
    case KEYBOARD_COMMANDS.captureFullPage:
      return "full-page";
    case KEYBOARD_COMMANDS.captureVisible:
      return "visible";
    case KEYBOARD_COMMANDS.captureSelection:
      return "selection";
    default:
      return null;
  }
}

async function handleUiRequest(message: UiRequest): Promise<UiResult<UiRequest["type"]>> {
  switch (message.type) {
    case "START_CAPTURE":
      void startCapture(message.mode);
      return { ok: true, started: true };

    case "CANCEL_CAPTURE":
      captureState.cancelRequested = true;
      return { ok: true, cancelled: true };

    case "GET_PROGRESS":
      return { ok: true, progress: captureState.progress };

    case "DOWNLOAD_CAPTURE":
      return downloadCapture(message.id, message.format, message.quality);

    case "RECAPTURE":
      void startCapture(message.mode, sourceTabByCaptureId.get(message.sourceId ?? ""));
      return { ok: true, started: true };

    default: {
      const exhaustiveCheck: never = message;
      throw new Error(`Unhandled UI request: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

function updateProgress(progress: CaptureProgress): void {
  captureState.progress = progress;
  broadcast({ type: "CAPTURE_PROGRESS", progress });
}

async function getCapturableTab(explicitTabId?: number): Promise<chrome.tabs.Tab> {
  let tab: chrome.tabs.Tab | undefined;
  if (explicitTabId !== undefined) {
    tab = await chrome.tabs.get(explicitTabId).catch(() => undefined);
  }
  if (!tab) {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  }
  if (!tab?.id || tab.windowId === undefined) {
    throw new Error("No active tab is available to capture.");
  }
  if (isRestrictedUrl(tab.url)) {
    throw new RestrictedPageError();
  }

  // captureVisibleTab only ever captures the foreground tab of a window, so bringing the
  // target tab (and its window) into focus is required — this matters for "Recapture", which
  // may be invoked from a different tab (the preview page) than the one being recaptured.
  if (!tab.active) {
    await chrome.tabs.update(tab.id, { active: true });
  }
  const window = await chrome.windows.get(tab.windowId);
  if (!window.focused) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }
  return tab;
}

class RestrictedPageError extends Error {
  constructor() {
    super(
      "Unable to capture this page. This page is restricted by the browser and cannot be captured."
    );
    this.name = "RestrictedPageError";
  }
}

async function startCapture(mode: CaptureMode, explicitTabId?: number): Promise<void> {
  if (captureState.busy) return;
  captureState.busy = true;
  captureState.cancelRequested = false;
  updateProgress({ status: "preparing", mode, current: 0, total: 0, message: "Starting…" });

  try {
    const tab = await getCapturableTab(explicitTabId);
    const settings = await getSettings();
    const callbacks = {
      onProgress: updateProgress,
      isCancelled: () => captureState.cancelRequested,
    };

    let encoded: EncodedImage;
    if (mode === "full-page") {
      encoded = await captureFullPage(tab, settings.capture, settings.output, callbacks);
    } else if (mode === "visible") {
      updateProgress({ status: "capturing", mode, current: 1, total: 1, message: "Capturing…" });
      encoded = await captureVisible(tab, settings.output);
    } else {
      encoded = await captureSelection(tab, settings.output, callbacks);
    }

    const result = await persistCaptureResult(encoded, tab, mode);
    if (tab.id !== undefined) sourceTabByCaptureId.set(result.id, tab.id);

    updateProgress({ status: "complete", mode, current: 1, total: 1, message: "Capture complete" });
    broadcast({ type: "CAPTURE_COMPLETE", result });
    await openPreviewTab(result.id);
  } catch (error) {
    if (error instanceof CaptureCancelledError) {
      updateProgress({ status: "cancelled", mode, current: 0, total: 0, message: "Capture cancelled" });
    } else {
      const extError = toExtensionError(error);
      updateProgress({ status: "failed", mode, current: 0, total: 0, message: extError.message });
      broadcast({ type: "CAPTURE_FAILED", error: extError });
    }
  } finally {
    captureState.busy = false;
  }
}

async function openPreviewTab(id: string): Promise<void> {
  await chrome.tabs.create({ url: chrome.runtime.getURL(`preview/preview.html?id=${id}`) });
}

async function persistCaptureResult(
  encoded: EncodedImage,
  tab: chrome.tabs.Tab,
  mode: CaptureMode
): Promise<CaptureResult> {
  const id = generateId();
  const settings = await getSettings();
  const blob = new Blob([encoded.buffer], { type: encoded.mimeType });
  const format: ImageFormat = encoded.mimeType === "image/jpeg" ? "jpeg" : "png";
  const createdAt = Date.now();
  const pageTitle = tab.title ?? "Untitled page";
  const pageUrl = tab.url ?? "";

  await saveImageBlob(id, blob);

  if (settings.history.enabled) {
    const thumbnailDataUrl = await createThumbnailDataUrl(blob, 240);
    await addHistoryEntry(
      {
        id,
        createdAt,
        mode,
        pageTitle,
        pageUrl,
        width: encoded.width,
        height: encoded.height,
        sizeBytes: blob.size,
        format,
        thumbnailDataUrl,
      },
      settings.history.maxItems
    );
  } else {
    // Without history, keep only this single transient capture around.
    const { lastTransientId } = await chrome.storage.session.get("lastTransientId");
    if (typeof lastTransientId === "string" && lastTransientId !== id) {
      await deleteImageBlob(lastTransientId);
    }
    await chrome.storage.session.set({ lastTransientId: id });
  }

  const result: CaptureResult = {
    id,
    mode,
    width: encoded.width,
    height: encoded.height,
    format,
    sizeBytes: blob.size,
    pageTitle,
    pageUrl,
    createdAt,
  };
  await chrome.storage.session.set({ lastCaptureId: id, lastCaptureResult: result });
  return result;
}

async function downloadCapture(
  id: string,
  format?: ImageFormat,
  quality?: number
): Promise<UiResult<"DOWNLOAD_CAPTURE">> {
  const blob = await getImageBlob(id);
  if (!blob) return { ok: false, error: { code: "NOT_FOUND", message: "That screenshot could not be found." } };

  const settings = await getSettings();
  const targetFormat = format ?? settings.output.format;
  const targetQuality = quality ?? settings.output.jpegQuality;

  let finalBlob = blob;
  const currentIsJpeg = blob.type === "image/jpeg";
  if ((targetFormat === "jpeg") !== currentIsJpeg) {
    const buffer = await blob.arrayBuffer();
    const dims = await getImageDimensions(buffer, blob.type);
    const encoded = await cropImage(
      buffer,
      blob.type,
      { x: 0, y: 0, width: dims.width, height: dims.height },
      1,
      targetFormat,
      targetQuality
    );
    finalBlob = new Blob([encoded.buffer], { type: encoded.mimeType });
  }

  const prefix = settings.output.filenamePrefix.replace(/[\\/:*?"<>|]/g, "-") || "screenshot";
  const extension = targetFormat === "jpeg" ? "jpg" : "png";
  const filename = `${prefix}-${formatTimestampForFilename(Date.now())}.${extension}`;

  const objectUrl = URL.createObjectURL(finalBlob);
  try {
    const downloadId = await chrome.downloads.download({ url: objectUrl, filename, saveAs: false });
    revokeWhenDownloadSettles(downloadId, objectUrl);
    return { ok: true, filename };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    return { ok: false, error: { code: "DOWNLOAD_FAILED", message: describeError(error) } };
  }
}

function revokeWhenDownloadSettles(downloadId: number, objectUrl: string): void {
  const listener = (delta: chrome.downloads.DownloadDelta) => {
    if (delta.id !== downloadId) return;
    if (delta.state?.current === "complete" || delta.state?.current === "interrupted") {
      URL.revokeObjectURL(objectUrl);
      chrome.downloads.onChanged.removeListener(listener);
    }
  };
  chrome.downloads.onChanged.addListener(listener);
  // Safety net in case onChanged never fires (e.g. the download was already finished synchronously).
  setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
    chrome.downloads.onChanged.removeListener(listener);
  }, 60_000);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toExtensionError(error: unknown): ExtensionError {
  if (error instanceof RestrictedPageError) {
    return { code: "RESTRICTED_PAGE", message: error.message };
  }
  const message = describeError(error);
  const code = classifyErrorMessage(message);
  return { code, message: friendlyMessageFor(code, message) };
}

function classifyErrorMessage(message: string): ExtensionErrorCode {
  const lower = message.toLowerCase();
  if (lower.includes("restricted")) return "RESTRICTED_PAGE";
  if (lower.includes("cancelled") || lower.includes("canceled")) return "CANCELLED";
  if (lower.includes("did not respond") || lower.includes("receiving end does not exist")) {
    return "CONTENT_SCRIPT_UNREACHABLE";
  }
  if (lower.includes("too large") || lower.includes("canvas")) return "CANVAS_LIMIT_EXCEEDED";
  if (lower.includes("max_capture_visible_tab")) return "CAPTURE_RATE_LIMIT";
  if (lower.includes("clipboard")) return "CLIPBOARD_UNAVAILABLE";
  if (lower.includes("download")) return "DOWNLOAD_FAILED";
  if (lower.includes("no active tab") || lower.includes("could not be identified")) return "UNSUPPORTED_PAGE";
  return "UNKNOWN";
}

function friendlyMessageFor(code: ExtensionErrorCode, original: string): string {
  switch (code) {
    case "CONTENT_SCRIPT_UNREACHABLE":
      return "Lost connection to the page — it may have navigated away during capture. Please try again.";
    case "CAPTURE_RATE_LIMIT":
      return "The browser is rate-limiting screenshot capture. Please wait a moment and try again.";
    default:
      return original;
  }
}
