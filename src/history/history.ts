import { recognizeText } from "../ocr/ocr-engine";
import { filterEntries } from "./search-filter";
import {
  clearHistory,
  deleteHistoryEntry,
  getAllOcrTexts,
  getHistory,
  getImageBlob,
  getOcrText,
  getSettings,
  saveOcrText,
} from "@shared/storage";
import { applyTheme } from "@shared/theme";
import type { HistoryEntry } from "@shared/types";
import { formatBytes } from "@shared/utilities";

const grid = document.getElementById("grid") as HTMLDivElement;
const emptyState = document.getElementById("emptyState") as HTMLDivElement;
const noMatchesState = document.getElementById("noMatchesState") as HTMLDivElement;
const historyDisabledState = document.getElementById("historyDisabledState") as HTMLDivElement;
const countLabel = document.getElementById("countLabel") as HTMLSpanElement;
const clearBtn = document.getElementById("clearBtn") as HTMLButtonElement;
const settingsBtn = document.getElementById("settingsButton") as HTMLButtonElement;
const searchInput = document.getElementById("searchInput") as HTMLInputElement;
const indexStatus = document.getElementById("indexStatus") as HTMLSpanElement;
const cardTemplate = document.getElementById("cardTemplate") as HTMLTemplateElement;

let entries: HistoryEntry[] = [];
const recognizedTexts = new Map<string, string>();
const cardsById = new Map<string, HTMLElement>();
let indexingRunning = false;

function openPreview(id: string): void {
  window.location.href = chrome.runtime.getURL(`preview/preview.html?id=${id}`);
}

function renderCard(entry: HistoryEntry): HTMLElement {
  const fragment = cardTemplate.content.cloneNode(true) as DocumentFragment;
  const card = fragment.querySelector(".history-card") as HTMLElement;
  const thumbButton = fragment.querySelector(".thumb-button") as HTMLButtonElement;
  const thumb = fragment.querySelector(".thumb") as HTMLImageElement;
  const title = fragment.querySelector(".card-title") as HTMLParagraphElement;
  const meta = fragment.querySelector(".card-meta") as HTMLParagraphElement;
  const openBtn = fragment.querySelector(".open-btn") as HTMLButtonElement;
  const deleteBtn = fragment.querySelector(".delete-btn") as HTMLButtonElement;

  thumb.src = entry.thumbnailDataUrl;
  thumb.alt = entry.pageTitle;
  title.textContent = entry.pageTitle || "Untitled page";
  meta.textContent = `${entry.width}×${entry.height} · ${formatBytes(entry.sizeBytes)} · ${new Date(
    entry.createdAt
  ).toLocaleDateString()}`;

  thumbButton.addEventListener("click", () => openPreview(entry.id));
  openBtn.addEventListener("click", () => openPreview(entry.id));
  deleteBtn.addEventListener("click", async () => {
    await deleteHistoryEntry(entry.id);
    entries = entries.filter((item) => item.id !== entry.id);
    recognizedTexts.delete(entry.id);
    cardsById.delete(entry.id);
    card.remove();
    await refreshCount();
    applyFilter();
  });

  cardsById.set(entry.id, card);
  return card;
}

function applyFilter(): void {
  const matches = new Set(filterEntries(entries, recognizedTexts, searchInput.value).map((e) => e.id));
  for (const [id, card] of cardsById) {
    card.hidden = !matches.has(id);
  }
  noMatchesState.hidden = entries.length === 0 || matches.size !== 0;
}

/** OCR-indexes captures that don't have recognized text yet, one at a time, so the
 *  page stays responsive. Results are cached in IndexedDB and reused by the preview
 *  page's "Copy text" button (and vice versa). */
async function indexMissingText(): Promise<void> {
  if (indexingRunning) return;
  indexingRunning = true;
  try {
    const pending = entries.filter((entry) => !recognizedTexts.has(entry.id));
    for (let i = 0; i < pending.length; i++) {
      const entry = pending[i];
      if (!entry) continue;
      indexStatus.textContent = `Indexing text ${i + 1} of ${pending.length}…`;
      try {
        const cached = await getOcrText(entry.id);
        if (cached !== null) {
          recognizedTexts.set(entry.id, cached);
        } else {
          const blob = await getImageBlob(entry.id);
          if (!blob) continue;
          const text = await recognizeText(blob);
          await saveOcrText(entry.id, text);
          recognizedTexts.set(entry.id, text);
        }
        if (searchInput.value.trim()) applyFilter();
      } catch (error) {
        console.warn("[Snapture] text indexing failed for", entry.id, error);
      }
    }
  } finally {
    indexStatus.textContent = "";
    indexingRunning = false;
  }
}

async function refreshCount(): Promise<void> {
  const settings = await getSettings();
  countLabel.textContent = `${entries.length} of ${settings.history.maxItems}`;
  emptyState.hidden = entries.length !== 0;
}

async function render(): Promise<void> {
  const settings = await getSettings();
  applyTheme(settings.appearance.theme);

  if (!settings.history.enabled) {
    historyDisabledState.hidden = false;
    clearBtn.disabled = true;
    searchInput.disabled = true;
    countLabel.textContent = "Disabled";
    return;
  }

  const [loadedEntries, loadedTexts] = await Promise.all([getHistory(), getAllOcrTexts()]);
  entries = loadedEntries;
  for (const [id, text] of loadedTexts) recognizedTexts.set(id, text);

  countLabel.textContent = `${entries.length} of ${settings.history.maxItems}`;
  emptyState.hidden = entries.length !== 0;

  grid.replaceChildren(...entries.map(renderCard));
  applyFilter();
  void indexMissingText();
}

searchInput.addEventListener("input", applyFilter);

clearBtn.addEventListener("click", async () => {
  if (!window.confirm("Delete all screenshot history? This cannot be undone.")) return;
  await clearHistory();
  entries = [];
  recognizedTexts.clear();
  cardsById.clear();
  grid.replaceChildren();
  await refreshCount();
  applyFilter();
});

settingsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

void render();
