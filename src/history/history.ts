import { clearHistory, deleteHistoryEntry, getHistory, getSettings } from "@shared/storage";
import { applyTheme } from "@shared/theme";
import type { HistoryEntry } from "@shared/types";
import { formatBytes } from "@shared/utilities";

const grid = document.getElementById("grid") as HTMLDivElement;
const emptyState = document.getElementById("emptyState") as HTMLDivElement;
const historyDisabledState = document.getElementById("historyDisabledState") as HTMLDivElement;
const countLabel = document.getElementById("countLabel") as HTMLSpanElement;
const clearBtn = document.getElementById("clearBtn") as HTMLButtonElement;
const settingsBtn = document.getElementById("settingsButton") as HTMLButtonElement;
const cardTemplate = document.getElementById("cardTemplate") as HTMLTemplateElement;

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
    card.remove();
    void refreshCount();
  });

  return card;
}

async function refreshCount(): Promise<void> {
  const [entries, settings] = await Promise.all([getHistory(), getSettings()]);
  countLabel.textContent = `${entries.length} of ${settings.history.maxItems}`;
  emptyState.hidden = entries.length !== 0;
}

async function render(): Promise<void> {
  const settings = await getSettings();
  applyTheme(settings.appearance.theme);

  if (!settings.history.enabled) {
    historyDisabledState.hidden = false;
    clearBtn.disabled = true;
    countLabel.textContent = "Disabled";
    return;
  }

  const entries = await getHistory();
  countLabel.textContent = `${entries.length} of ${settings.history.maxItems}`;
  emptyState.hidden = entries.length !== 0;

  grid.replaceChildren(...entries.map(renderCard));
}

clearBtn.addEventListener("click", async () => {
  if (!window.confirm("Delete all screenshot history? This cannot be undone.")) return;
  await clearHistory();
  grid.replaceChildren();
  await refreshCount();
});

settingsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

void render();
