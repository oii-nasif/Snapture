import { copyBlobToClipboard } from "@capture/image-processor";
import { onBroadcast, sendToBackground } from "@shared/messaging";
import { getImageBlob, getSettings } from "@shared/storage";
import { applyTheme } from "@shared/theme";
import type { CaptureMode, CaptureProgress } from "@shared/types";

const statusDot = document.getElementById("statusDot") as HTMLSpanElement;
const statusText = document.getElementById("statusText") as HTMLSpanElement;
const progressTrack = document.getElementById("progressTrack") as HTMLDivElement;
const progressFill = document.getElementById("progressFill") as HTMLDivElement;
const progressLabel = document.getElementById("progressLabel") as HTMLDivElement;
const errorBanner = document.getElementById("errorBanner") as HTMLDivElement;

const captureFullPageBtn = document.getElementById("captureFullPage") as HTMLButtonElement;
const captureVisibleBtn = document.getElementById("captureVisible") as HTMLButtonElement;
const captureSelectionBtn = document.getElementById("captureSelection") as HTMLButtonElement;
const actionButtons = [captureFullPageBtn, captureVisibleBtn, captureSelectionBtn];

const copyLastBtn = document.getElementById("copyLast") as HTMLButtonElement;
const openHistoryBtn = document.getElementById("openHistory") as HTMLButtonElement;
const settingsBtn = document.getElementById("settingsButton") as HTMLButtonElement;

const STATUS_LABELS: Record<CaptureProgress["status"], string> = {
  idle: "Ready",
  preparing: "Preparing…",
  capturing: "Capturing…",
  stitching: "Stitching…",
  complete: "Complete",
  failed: "Failed",
  cancelled: "Cancelled",
};

async function init(): Promise<void> {
  const settings = await getSettings();
  applyTheme(settings.appearance.theme);

  const progressResult = await sendToBackground({ type: "GET_PROGRESS" });
  if (progressResult.ok) renderProgress(progressResult.progress);

  await refreshCopyLastAvailability();

  onBroadcast((message) => {
    if (message.type === "CAPTURE_PROGRESS") renderProgress(message.progress);
    // The preview tab takes over from here — close the popup rather than leaving it hovering
    // over the preview (where a re-capture would target the extension's own restricted page).
    if (message.type === "CAPTURE_COMPLETE") window.close();
    if (message.type === "CAPTURE_FAILED") showError(message.error.message);
  });
}

function renderProgress(progress: CaptureProgress): void {
  const busy = progress.status === "preparing" || progress.status === "capturing" || progress.status === "stitching";
  statusText.textContent = progress.message || STATUS_LABELS[progress.status];
  statusDot.dataset.state = busy
    ? "busy"
    : progress.status === "complete"
      ? "complete"
      : progress.status === "failed"
        ? "failed"
        : "idle";

  actionButtons.forEach((button) => (button.disabled = busy));

  if (busy && progress.total > 1) {
    progressTrack.hidden = false;
    progressLabel.hidden = false;
    const pct = Math.round((progress.current / progress.total) * 100);
    progressFill.style.width = `${pct}%`;
    progressLabel.textContent = `${progress.current} / ${progress.total} sections`;
  } else {
    progressTrack.hidden = true;
    progressLabel.hidden = true;
  }

  if (progress.status !== "failed") {
    errorBanner.hidden = true;
  }
}

function showError(message: string): void {
  errorBanner.hidden = false;
  errorBanner.textContent = message;
}

async function refreshCopyLastAvailability(): Promise<void> {
  const { lastCaptureId } = await chrome.storage.session.get("lastCaptureId");
  copyLastBtn.disabled = typeof lastCaptureId !== "string";
}

function startCapture(mode: CaptureMode): void {
  errorBanner.hidden = true;
  void sendToBackground({ type: "START_CAPTURE", mode });
}

captureFullPageBtn.addEventListener("click", () => startCapture("full-page"));
captureVisibleBtn.addEventListener("click", () => startCapture("visible"));
captureSelectionBtn.addEventListener("click", () => {
  startCapture("selection");
  window.close();
});

copyLastBtn.addEventListener("click", async () => {
  const { lastCaptureId } = await chrome.storage.session.get("lastCaptureId");
  if (typeof lastCaptureId !== "string") return;
  try {
    const blob = await getImageBlob(lastCaptureId);
    if (!blob) throw new Error("That screenshot could not be found.");
    await copyBlobToClipboard(blob);
    statusText.textContent = "Copied to clipboard";
  } catch (error) {
    showError(error instanceof Error ? error.message : "Clipboard access is not available.");
  }
});

openHistoryBtn.addEventListener("click", () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL("history/history.html") });
});

settingsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

void init();
