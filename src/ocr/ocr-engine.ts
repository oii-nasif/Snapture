import { createWorker, OEM } from "tesseract.js";
import type { Worker as OcrWorker } from "tesseract.js";
import { normalizeRecognizedText } from "./text-normalize";

/**
 * On-device OCR built on tesseract.js. The worker script, wasm core, and language
 * data are all bundled with the extension (see scripts/build.mjs) — recognition never
 * touches the network. Runs in extension pages only: the worker it spawns is not
 * available inside the background service worker.
 *
 * workerBlobURL must be false — the default blob: worker is blocked by the
 * extension-pages CSP, so the worker is constructed from its packaged URL instead.
 */
let workerPromise: Promise<OcrWorker> | null = null;

function getWorker(): Promise<OcrWorker> {
  if (workerPromise) return workerPromise;
  const attempt = createWorker("eng", OEM.LSTM_ONLY, {
    workerPath: chrome.runtime.getURL("ocr/worker.min.js"),
    corePath: chrome.runtime.getURL("ocr/core/tesseract-core-simd-lstm.wasm.js"),
    langPath: chrome.runtime.getURL("ocr/lang"),
    workerBlobURL: false,
    cacheMethod: "none",
  });
  workerPromise = attempt.catch((error: unknown) => {
    workerPromise = null;
    throw error;
  });
  return workerPromise;
}

export async function recognizeText(image: Blob): Promise<string> {
  const worker = await getWorker();
  const { data } = await worker.recognize(image);
  return normalizeRecognizedText(data.text);
}
