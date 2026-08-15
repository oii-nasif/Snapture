import {
  DEFAULT_SETTINGS,
  IMAGE_DB_NAME,
  IMAGE_DB_STORE,
  IMAGE_DB_VERSION,
  STORAGE_KEYS,
} from "./constants";
import type { ExtensionSettings, HistoryEntry } from "./types";

/** chrome.storage.local holds settings + small history metadata (thumbnails only, never full images). */

export async function getSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.settings);
  const settings = stored[STORAGE_KEYS.settings] as Partial<ExtensionSettings> | undefined;
  if (!settings) return DEFAULT_SETTINGS;
  return {
    capture: { ...DEFAULT_SETTINGS.capture, ...settings.capture },
    output: { ...DEFAULT_SETTINGS.output, ...settings.output },
    history: { ...DEFAULT_SETTINGS.history, ...settings.history },
    appearance: { ...DEFAULT_SETTINGS.appearance, ...settings.appearance },
  };
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: settings });
}

export async function getHistory(): Promise<HistoryEntry[]> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.history);
  const entries = stored[STORAGE_KEYS.history] as HistoryEntry[] | undefined;
  return entries ?? [];
}

async function saveHistory(entries: HistoryEntry[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.history]: entries });
}

/** Prepends a new entry and prunes (deleting the backing image blobs) beyond maxItems. */
export async function addHistoryEntry(entry: HistoryEntry, maxItems: number): Promise<void> {
  const existing = await getHistory();
  const next = [entry, ...existing];
  const overflow = next.slice(maxItems);
  const kept = next.slice(0, maxItems);
  await saveHistory(kept);
  await Promise.all(overflow.map((item) => deleteImageBlob(item.id)));
}

export async function deleteHistoryEntry(id: string): Promise<void> {
  const existing = await getHistory();
  await saveHistory(existing.filter((entry) => entry.id !== id));
  await deleteImageBlob(id);
}

export async function clearHistory(): Promise<void> {
  const existing = await getHistory();
  await saveHistory([]);
  await Promise.all(existing.map((entry) => deleteImageBlob(entry.id)));
}

/** Full-resolution screenshot bytes live in IndexedDB — chrome.storage.local's ~10MB quota
 *  is easily exceeded by a handful of full-page PNGs. */
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(IMAGE_DB_NAME, IMAGE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IMAGE_DB_STORE)) {
        db.createObjectStore(IMAGE_DB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open image database"));
  });
  return dbPromise;
}

export async function saveImageBlob(id: string, blob: Blob): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IMAGE_DB_STORE, "readwrite");
    tx.objectStore(IMAGE_DB_STORE).put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to save image"));
  });
}

export async function getImageBlob(id: string): Promise<Blob | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IMAGE_DB_STORE, "readonly");
    const request = tx.objectStore(IMAGE_DB_STORE).get(id);
    request.onsuccess = () => resolve((request.result as Blob | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error("Failed to read image"));
  });
}

export async function deleteImageBlob(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IMAGE_DB_STORE, "readwrite");
    tx.objectStore(IMAGE_DB_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to delete image"));
  });
}
