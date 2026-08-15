import { initCaptureController } from "./capture-controller";

declare global {
  interface Window {
    __snaptureLoaded?: boolean;
  }
}

// Injected on demand via chrome.scripting.executeScript, possibly more than once per page
// (e.g. two captures without a navigation in between) — guard against double-registering.
if (!window.__snaptureLoaded) {
  window.__snaptureLoaded = true;
  initCaptureController();
}
