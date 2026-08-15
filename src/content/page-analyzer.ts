import type { PageMetrics, Rect } from "@shared/types";

/** Reads the current viewport/document dimensions and scroll offsets, ignoring scroll containers. */
export function getPageMetrics(): PageMetrics {
  return {
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    documentWidth: getDocumentWidth(),
    documentHeight: getDocumentHeight(),
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    devicePixelRatio: window.devicePixelRatio || 1,
    captureOffsetX: 0,
    captureOffsetY: 0,
    needsCrop: false,
  };
}

/** Cross-browser "full document height", robust to quirks-mode and mismatched body/html sizing. */
export function getDocumentHeight(): number {
  const body = document.body;
  const root = document.documentElement;
  return Math.max(
    body?.scrollHeight ?? 0,
    body?.offsetHeight ?? 0,
    root.scrollHeight,
    root.offsetHeight,
    root.clientHeight
  );
}

export function getDocumentWidth(): number {
  const body = document.body;
  const root = document.documentElement;
  return Math.max(
    body?.scrollWidth ?? 0,
    body?.offsetWidth ?? 0,
    root.scrollWidth,
    root.offsetWidth,
    root.clientWidth
  );
}

export interface ScrollRoot {
  /** True when the document itself scrolls (the common case). False for apps — Confluence,
   *  Notion, many dashboards — that scroll a single inner container instead. */
  isDocument: boolean;
  element: HTMLElement | null;
  /** On-screen rect (viewport CSS px) of the scrollable region. */
  rect: Rect;
  scrollWidth: number;
  scrollHeight: number;
}

const MIN_SCROLLABLE_EXCESS_PX = 40;
const MIN_CONTAINER_AREA_RATIO = 0.35;

/**
 * Finds what actually scrolls on this page. Most pages scroll `document.documentElement`, but
 * plenty of modern apps fix the outer page and scroll a single inner `overflow: auto` container
 * instead — if we only ever scrolled the window on those, full-page capture would silently
 * produce a single-viewport screenshot. Falls back to treating the page as a single viewport
 * if nothing scrollable can be found, rather than guessing wrong.
 */
export function findScrollRoot(): ScrollRoot {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const fullViewportRoot: ScrollRoot = {
    isDocument: true,
    element: null,
    rect: { x: 0, y: 0, width: viewportWidth, height: viewportHeight },
    scrollWidth: getDocumentWidth(),
    scrollHeight: getDocumentHeight(),
  };

  if (fullViewportRoot.scrollHeight - viewportHeight > MIN_SCROLLABLE_EXCESS_PX) {
    return fullViewportRoot;
  }

  const minArea = viewportWidth * viewportHeight * MIN_CONTAINER_AREA_RATIO;
  let best: { element: HTMLElement; rect: DOMRect; area: number } | null = null;

  document.body.querySelectorAll<HTMLElement>("*").forEach((element) => {
    const style = window.getComputedStyle(element);
    if (style.overflowY !== "auto" && style.overflowY !== "scroll") return;

    const excess = element.scrollHeight - element.clientHeight;
    if (excess <= MIN_SCROLLABLE_EXCESS_PX) return;

    const rect = element.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area < minArea) return;
    if (rect.bottom <= 0 || rect.top >= viewportHeight) return;

    // Rank by on-screen footprint, not by how much overflow content it has. A small widget
    // (e.g. a comment box with a long hidden history) can have a huge scrollHeight while
    // occupying almost none of the screen — ranking by excess would let it outrank the actual
    // main content pane and hijack the whole capture onto essentially blank space.
    if (!best || area > best.area) {
      best = { element, rect, area };
    }
  });

  if (!best) return fullViewportRoot;

  const found: { element: HTMLElement; rect: DOMRect; area: number } = best;
  const x = Math.max(0, found.rect.left);
  const y = Math.max(0, found.rect.top);
  const width = Math.min(viewportWidth, found.rect.right) - x;
  const height = Math.min(viewportHeight, found.rect.bottom) - y;
  if (width <= 0 || height <= 0) return fullViewportRoot;

  return {
    isDocument: false,
    element: found.element,
    rect: { x, y, width, height },
    scrollWidth: found.element.scrollWidth,
    scrollHeight: found.element.scrollHeight,
  };
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Waits for `<img>` elements currently visible within `rect` to finish loading (or fail), up to
 * `maxWaitMs`. A page-height check alone misses this: an image finishing to load doesn't change
 * scroll height, but capturing before it paints leaves a visible gap in the stitched screenshot.
 */
export async function waitForImagesToSettle(rect: Rect, maxWaitMs: number): Promise<void> {
  const pending = Array.from(document.querySelectorAll("img")).filter((img) => {
    if (img.complete) return false;
    const r = img.getBoundingClientRect();
    return (
      r.bottom > rect.y &&
      r.top < rect.y + rect.height &&
      r.right > rect.x &&
      r.left < rect.x + rect.width
    );
  });
  if (pending.length === 0) return;

  const loaded = Promise.all(
    pending.map(
      (img) =>
        new Promise<void>((resolve) => {
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
        })
    )
  );
  await Promise.race([loaded, sleep(maxWaitMs)]);
}

/**
 * Waits at least `minWaitMs` (the user's configured scroll delay — a floor, not a suggestion),
 * then keeps polling `measure` (document height by default) until two consecutive reads agree
 * or `maxWaitMs` elapses. The floor matters: apps like Confluence render complex content
 * (status badges, avatars, embedded issue cards) into a scroll container whose *height* never
 * changes — only height-based "is it settled yet" checks would falsely declare victory after a
 * single ~80ms poll, capturing blank/half-rendered content.
 */
export async function waitForStableLayout(
  minWaitMs: number,
  maxWaitMs: number,
  measure: () => number = getDocumentHeight
): Promise<number> {
  await nextFrame();
  await nextFrame();

  const pollIntervalMs = 80;
  const start = Date.now();
  const deadline = start + Math.max(minWaitMs, maxWaitMs);
  let lastValue = measure();

  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);
    const value = measure();
    if (value === lastValue && Date.now() - start >= minWaitMs) {
      return value;
    }
    lastValue = value;
  }
  return lastValue;
}
