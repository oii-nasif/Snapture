import type { Rect } from "@shared/types";

const OVERLAY_MARKER_ATTR = "data-fps-overlay";
const FROZEN_MARKER_ATTR = "data-fps-frozen";

/**
 * Never hide an element taller than this share of the capture area. Genuine sticky
 * headers/footers/cookie banners/chat bubbles are short; a tall fixed/sticky element is almost
 * always a layout wrapper that CONTAINS the page content (Confluence's content grid, app shells,
 * split-pane layouts). Hiding one of those blanks the entire capture — far worse than letting an
 * unusually tall sticky sidebar repeat across frames.
 */
const MAX_HIDEABLE_HEIGHT_RATIO = 0.3;

/** Minimum scroll distance between two frames for movement-based detection to be meaningful. */
const MIN_STATIONARY_SCROLL_DELTA_PX = 40;
/** An element whose viewport top moved less than this across a qualifying scroll is pinned. */
const STATIONARY_TOLERANCE_PX = 2;

type StickyClassification = "top" | "bottom" | "always-hide";

interface TrackedElement {
  element: HTMLElement;
  classification: StickyClassification;
  originalCssText: string;
}

/** Depth-first walk of every element under `root`, descending into open shadow roots —
 *  `querySelectorAll` alone never sees inside them, and floating widgets often live there. */
function* walkElements(root: ParentNode): Generator<HTMLElement> {
  for (const element of root.querySelectorAll<HTMLElement>("*")) {
    yield element;
    if (element.shadowRoot) {
      yield* walkElements(element.shadowRoot);
    }
  }
}

/**
 * Finds elements that stay pinned on screen while the page scrolls — and hides them during
 * intermediate scroll captures so they don't get baked into the stitched image dozens of times.
 *
 * Three ways an element qualifies:
 * 1. Computed `position: fixed` or `sticky` — the classic case.
 * 2. When the capture scrolls an *inner container* (Confluence, Notion, dashboards): any element
 *    that overlaps the capture region but lives **outside the scroll container's subtree** —
 *    such elements never move when the container scrolls, whatever their computed position.
 * 3. Movement-based: an element whose on-screen position did not change between two frames even
 *    though the page scrolled meaningfully. This is the net that catches JavaScript-pinned
 *    UI (absolute elements repositioned on every scroll event, transform-pinned widgets,
 *    closed-shadow-DOM hosts) that no CSS inspection can identify. These are hidden for every
 *    remaining frame — including the last — because by the time behavior reveals them they've
 *    already appeared once, and showing them again would duplicate them.
 *
 * Elements found by (1)/(2) in the top half of the captured area are "header-like" and kept
 * visible only for the first frame; bottom half → "footer-like", last frame only. Tall elements
 * are deliberately left alone (see MAX_HIDEABLE_HEIGHT_RATIO).
 *
 * The scan re-runs before every frame (`applyForFrame`) — apps mount floating UI *during*
 * scrolling, and anything born mid-capture would otherwise repeat at every frame boundary.
 *
 * All mutations are `visibility` only (never `display`), so layout never reflows, and every
 * change is reverted in `restore()` even if capture fails partway through.
 */
export class StickyElementManager {
  private tracked: TrackedElement[] = [];
  private active = false;
  private captureRect: Rect = { x: 0, y: 0, width: 0, height: 0 };
  private scrollRoot: HTMLElement | null = null;
  private prevTops = new Map<HTMLElement, number>();
  private prevScrollY: number | null = null;

  /**
   * `captureRect` is the on-screen region actually being captured (see `findScrollRoot`).
   * `scrollRoot` is the inner scroll container element when one is being scrolled, or `null`
   * when the document itself scrolls — it enables the outside-the-subtree detection above.
   */
  freeze(captureRect: Rect, scrollRoot: HTMLElement | null): number {
    this.tracked = [];
    this.captureRect = captureRect;
    this.scrollRoot = scrollRoot;
    this.prevTops = new Map();
    this.prevScrollY = null;
    this.active = true;
    this.scan(null);
    return this.tracked.length;
  }

  /**
   * Observation-only pass for the pre-capture probe scrolls: snapshots positions and runs
   * movement-based detection WITHOUT hiding anything. Elements detected here are classified by
   * position (top/bottom) like CSS-pinned ones — they haven't been captured yet, so they still
   * get their one legitimate appearance. (Never classified always-hide: if a page pins the
   * ORIGINAL header element rather than a clone, always-hiding it would erase the header from
   * the capture entirely.)
   */
  observe(scrollY: number): void {
    if (!this.active) return;
    this.scan(scrollY, "positional");
  }

  /**
   * Call before capturing each frame; rescans for newly mounted pinned elements, then hides
   * everything irrelevant to that frame's position. Pass `scrollY` (the settled scroll offset)
   * from the post-scroll call site to enable movement-based detection — omit it for pre-scroll
   * calls where the layout is about to change anyway.
   */
  applyForFrame(isFirst: boolean, isLast: boolean, scrollY?: number): void {
    if (!this.active) return;
    this.scan(scrollY ?? null, "always-hide");
    for (const item of this.tracked) {
      const shouldShow =
        (item.classification === "top" && isFirst) ||
        (item.classification === "bottom" && isLast);
      item.element.style.setProperty("visibility", shouldShow ? "" : "hidden", "important");
    }
  }

  restore(): void {
    for (const item of this.tracked) {
      item.element.style.cssText = item.originalCssText;
      item.element.removeAttribute(FROZEN_MARKER_ATTR);
    }
    this.tracked = [];
    this.active = false;
    this.scrollRoot = null;
    this.prevTops = new Map();
    this.prevScrollY = null;
  }

  /** Tracks qualifying elements not seen before. Safe to call repeatedly: already tracked
   *  elements carry FROZEN_MARKER_ATTR and are skipped, so their `originalCssText` is captured
   *  exactly once, before any mutation. When `scrollY` is provided, also runs movement-based
   *  detection against the previous frame's snapshot and records a fresh snapshot;
   *  `stationaryMode` decides how detected elements are classified (see `observe`). */
  private scan(scrollY: number | null, stationaryMode: "positional" | "always-hide" = "always-hide"): void {
    const viewportHeight = window.innerHeight;
    const { x, y, width, height } = this.captureRect;
    const midpoint = y + height / 2;

    const canDetectStationary =
      scrollY !== null &&
      this.prevScrollY !== null &&
      Math.abs(scrollY - this.prevScrollY) >= MIN_STATIONARY_SCROLL_DELTA_PX;
    const nextTops = scrollY !== null ? new Map<HTMLElement, number>() : null;

    for (const element of walkElements(document.body)) {
      // closest() also skips descendants of an already-tracked element — hiding the ancestor
      // already hides them, so tracking each child individually would be pure bloat.
      if (element.closest(`[${FROZEN_MARKER_ATTR}]`)) continue;
      if (element.closest(`[${OVERLAY_MARKER_ATTR}]`)) continue;

      const style = window.getComputedStyle(element);
      if (style.visibility === "hidden" || style.display === "none") continue;

      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.bottom < 0 || rect.top > viewportHeight) continue;
      const overlapsCapture = rect.right > x && rect.left < x + width && rect.bottom > y && rect.top < y + height;
      // scrollHeight (not just the border box) so a short wrapper with tall overflowing
      // children — whose descendants visibility:hidden would also blank — is caught too.
      const smallEnough = Math.max(rect.height, element.scrollHeight) <= height * MAX_HIDEABLE_HEIGHT_RATIO;

      const isCssPinned = style.position === "fixed" || style.position === "sticky";
      const isOutsideScrollRoot =
        this.scrollRoot !== null &&
        !this.scrollRoot.contains(element) &&
        !element.contains(this.scrollRoot);

      if (smallEnough && (isCssPinned || (isOutsideScrollRoot && overlapsCapture))) {
        const classification: StickyClassification = rect.top + rect.height / 2 < midpoint ? "top" : "bottom";
        this.track(element, classification);
        continue;
      }

      // Movement-based path: candidates are small visible elements over the capture region.
      if (!smallEnough || !overlapsCapture || nextTops === null) continue;

      if (canDetectStationary) {
        const prevTop = this.prevTops.get(element);
        if (prevTop !== undefined && Math.abs(rect.top - prevTop) <= STATIONARY_TOLERANCE_PX) {
          this.track(
            element,
            stationaryMode === "positional"
              ? rect.top + rect.height / 2 < midpoint
                ? "top"
                : "bottom"
              : "always-hide"
          );
          continue;
        }
      }
      nextTops.set(element, rect.top);
    }

    if (nextTops !== null && scrollY !== null) {
      this.prevTops = nextTops;
      this.prevScrollY = scrollY;
    }
  }

  private track(element: HTMLElement, classification: StickyClassification): void {
    this.tracked.push({
      element,
      classification,
      originalCssText: element.style.cssText,
    });
    element.setAttribute(FROZEN_MARKER_ATTR, "true");
  }
}
