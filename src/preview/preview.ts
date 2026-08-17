import { copyBlobToClipboard } from "@capture/image-processor";
import { recognizeText } from "../ocr/ocr-engine";
import { sendToBackground } from "@shared/messaging";
import {
  deleteHistoryEntry,
  getHistory,
  getImageBlob,
  getOcrText,
  getSettings,
  saveOcrText,
} from "@shared/storage";
import { applyTheme } from "@shared/theme";
import type { CaptureResult, ImageFormat } from "@shared/types";
import { formatBytes } from "@shared/utilities";

const viewerScroll = document.getElementById("viewerScroll") as HTMLDivElement;
const emptyState = document.getElementById("emptyState") as HTMLDivElement;
const screenshotImage = document.getElementById("screenshotImage") as HTMLImageElement;

const pageTitleEl = document.getElementById("pageTitle") as HTMLHeadingElement;
const pageUrlEl = document.getElementById("pageUrl") as HTMLAnchorElement;
const dimensionsEl = document.getElementById("dimensions") as HTMLElement;
const fileSizeEl = document.getElementById("fileSize") as HTMLElement;
const capturedAtEl = document.getElementById("capturedAt") as HTMLElement;
const formatLabelEl = document.getElementById("formatLabel") as HTMLElement;

const formatSelect = document.getElementById("formatSelect") as HTMLSelectElement;
const qualityRow = document.getElementById("qualityRow") as HTMLDivElement;
const qualitySlider = document.getElementById("qualitySlider") as HTMLInputElement;
const qualityValue = document.getElementById("qualityValue") as HTMLSpanElement;

const downloadBtn = document.getElementById("downloadBtn") as HTMLButtonElement;
const copyBtn = document.getElementById("copyBtn") as HTMLButtonElement;
const copyTextBtn = document.getElementById("copyTextBtn") as HTMLButtonElement;
const recaptureBtn = document.getElementById("recaptureBtn") as HTMLButtonElement;
const deleteBtn = document.getElementById("deleteBtn") as HTMLButtonElement;
const feedback = document.getElementById("feedback") as HTMLParagraphElement;

const historyLink = document.getElementById("historyLink") as HTMLButtonElement;
const goToHistoryBtn = document.getElementById("goToHistory") as HTMLButtonElement;

let currentResult: CaptureResult | null = null;
let objectUrl: string | null = null;

function goToHistoryPage(): void {
  window.location.href = chrome.runtime.getURL("history/history.html");
}

historyLink.addEventListener("click", goToHistoryPage);
goToHistoryBtn.addEventListener("click", goToHistoryPage);

async function findResultMetadata(id: string): Promise<CaptureResult | null> {
  const history = await getHistory();
  const fromHistory = history.find((entry) => entry.id === id);
  if (fromHistory) {
    return {
      id: fromHistory.id,
      mode: fromHistory.mode,
      width: fromHistory.width,
      height: fromHistory.height,
      format: fromHistory.format,
      sizeBytes: fromHistory.sizeBytes,
      pageTitle: fromHistory.pageTitle,
      pageUrl: fromHistory.pageUrl,
      createdAt: fromHistory.createdAt,
    };
  }
  const { lastCaptureResult } = await chrome.storage.session.get("lastCaptureResult");
  if (lastCaptureResult && (lastCaptureResult as CaptureResult).id === id) {
    return lastCaptureResult as CaptureResult;
  }
  return null;
}

function showEmptyState(): void {
  emptyState.hidden = false;
  viewerScroll.hidden = true;
  [downloadBtn, copyBtn, copyTextBtn, recaptureBtn, deleteBtn].forEach((btn) => (btn.disabled = true));
}

function setFeedback(message: string, isError = false): void {
  feedback.textContent = message;
  feedback.dataset.error = String(isError);
}

async function init(): Promise<void> {
  const settings = await getSettings();
  applyTheme(settings.appearance.theme);
  formatSelect.value = settings.output.format;
  qualitySlider.value = String(settings.output.jpegQuality);
  qualityValue.textContent = String(settings.output.jpegQuality);
  qualityRow.hidden = settings.output.format !== "jpeg";

  const id = new URLSearchParams(window.location.search).get("id");
  if (!id) {
    showEmptyState();
    return;
  }

  const [metadata, blob] = await Promise.all([findResultMetadata(id), getImageBlob(id)]);
  if (!metadata || !blob) {
    showEmptyState();
    return;
  }

  currentResult = metadata;
  objectUrl = URL.createObjectURL(blob);
  screenshotImage.src = objectUrl;

  pageTitleEl.textContent = metadata.pageTitle;
  pageUrlEl.textContent = metadata.pageUrl;
  pageUrlEl.href = metadata.pageUrl || "#";
  dimensionsEl.textContent = `${metadata.width} × ${metadata.height}px`;
  fileSizeEl.textContent = formatBytes(metadata.sizeBytes);
  capturedAtEl.textContent = new Date(metadata.createdAt).toLocaleString();
  formatLabelEl.textContent = metadata.format.toUpperCase();
}

window.addEventListener("unload", () => {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
});

formatSelect.addEventListener("change", () => {
  qualityRow.hidden = formatSelect.value !== "jpeg";
});

qualitySlider.addEventListener("input", () => {
  qualityValue.textContent = qualitySlider.value;
});

downloadBtn.addEventListener("click", async () => {
  if (!currentResult) return;
  downloadBtn.disabled = true;
  setFeedback("Downloading…");
  const format = formatSelect.value as ImageFormat;
  const quality = Number(qualitySlider.value);
  const result = await sendToBackground({
    type: "DOWNLOAD_CAPTURE",
    id: currentResult.id,
    format,
    quality,
  });
  downloadBtn.disabled = false;
  if (result.ok) {
    setFeedback(`Saved as ${result.filename}`);
  } else {
    setFeedback(result.error.message, true);
  }
});

copyBtn.addEventListener("click", async () => {
  if (!currentResult) return;
  copyBtn.disabled = true;
  try {
    const blob = await getImageBlob(currentResult.id);
    if (!blob) throw new Error("That screenshot could not be found.");
    await copyBlobToClipboard(blob);
    setFeedback("Copied to clipboard");
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : "Clipboard access is not available.", true);
  } finally {
    copyBtn.disabled = false;
  }
});

copyTextBtn.addEventListener("click", async () => {
  if (!currentResult) return;
  copyTextBtn.disabled = true;
  setFeedback("Recognizing text…");
  try {
    let text = await getOcrText(currentResult.id);
    if (text === null) {
      const blob = await getImageBlob(currentResult.id);
      if (!blob) throw new Error("That screenshot could not be found.");
      text = await recognizeText(blob);
      await saveOcrText(currentResult.id, text);
    }
    if (!text) {
      setFeedback("No text was found in this screenshot.");
    } else {
      await navigator.clipboard.writeText(text);
      setFeedback("Text copied to clipboard");
    }
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : "Text recognition failed.", true);
  } finally {
    copyTextBtn.disabled = false;
  }
});

recaptureBtn.addEventListener("click", async () => {
  if (!currentResult) return;
  recaptureBtn.disabled = true;
  setFeedback("Recapturing…");
  await sendToBackground({ type: "RECAPTURE", mode: currentResult.mode, sourceId: currentResult.id });
  window.close();
});

deleteBtn.addEventListener("click", async () => {
  if (!currentResult) return;
  deleteBtn.disabled = true;
  try {
    await deleteHistoryEntry(currentResult.id);
  } catch (error) {
    deleteBtn.disabled = false;
    setFeedback(error instanceof Error ? error.message : "Failed to delete screenshot.", true);
    return;
  }
  currentResult = null;
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
  screenshotImage.removeAttribute("src");
  pageTitleEl.textContent = "—";
  pageUrlEl.textContent = "—";
  pageUrlEl.href = "#";
  dimensionsEl.textContent = "—";
  fileSizeEl.textContent = "—";
  capturedAtEl.textContent = "—";
  formatLabelEl.textContent = "—";
  showEmptyState();
  setFeedback("Screenshot deleted");
});

void init();
