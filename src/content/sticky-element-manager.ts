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

type StickyClassification = "top" | "bottom";

interface TrackedElement {
  element: HTMLElement;
  classification: StickyClassification;
  originalCssText: string;
}

/**
 * Finds small fixed/sticky elements (headers, cookie banners, chat widgets) and hides them
 * during intermediate scroll captures so they don't get baked into the stitched image dozens of
 * times. Elements in the top half of the captured area are treated as "header-like" and kept
 * visible only for the first frame; ones in the bottom half are "footer-like" and kept visible
 * only for the last frame. Everything else is hidden for every frame in between. Tall
 * fixed/sticky elements are deliberately left alone (see MAX_HIDEABLE_HEIGHT_RATIO).
 * All mutations are `visibility` only (never `display`), so layout never reflows, and every
 * change is reverted in `restore()` even if capture fails partway through.
 */
export class StickyElementManager {
  private tracked: TrackedElement[] = [];
  private active = false;

  /** `captureRect` is the on-screen region actually being captured (see `findScrollRoot`) —
   *  used to decide whether an element sits in the top or bottom half of the captured area, not
   *  necessarily the whole browser viewport (e.g. apps that scroll an inner container). */
  freeze(captureRect: Rect): number {
    this.tracked = [];
    const viewportHeight = window.innerHeight;
    const midpoint = captureRect.y + captureRect.height / 2;
    const candidates = document.body.querySelectorAll<HTMLElement>("*");

    candidates.forEach((element) => {
      if (element.hasAttribute(OVERLAY_MARKER_ATTR)) return;
      if (element.closest(`[${OVERLAY_MARKER_ATTR}]`)) return;

      const style = window.getComputedStyle(element);
      if (style.position !== "fixed" && style.position !== "sticky") return;
      if (style.visibility === "hidden" || style.display === "none") return;

      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      if (rect.bottom < 0 || rect.top > viewportHeight) return;
      // scrollHeight (not just the border box) so a short wrapper with tall overflowing
      // children — whose descendants visibility:hidden would also blank — is caught too.
      if (Math.max(rect.height, element.scrollHeight) > captureRect.height * MAX_HIDEABLE_HEIGHT_RATIO) return;

      const classification: StickyClassification = rect.top + rect.height / 2 < midpoint ? "top" : "bottom";

      this.tracked.push({
        element,
        classification,
        originalCssText: element.style.cssText,
      });
      element.setAttribute(FROZEN_MARKER_ATTR, "true");
    });

    this.active = true;
    return this.tracked.length;
  }

  /** Call before capturing each frame; hides elements irrelevant to that frame's position. */
  applyForFrame(isFirst: boolean, isLast: boolean): void {
    if (!this.active) return;
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
  }
}
