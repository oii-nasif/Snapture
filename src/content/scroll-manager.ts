import type { Rect } from "@shared/types";
import { getDocumentHeight, waitForImagesToSettle, waitForStableLayout } from "./page-analyzer";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ScrollResult {
  actualY: number;
  documentHeight: number;
}

const FULL_VIEWPORT_RECT: Rect = { x: 0, y: 0, width: Infinity, height: Infinity };

/**
 * Drives scrolling for capture and restores the original position afterward. Scrolls either the
 * window (ordinary pages) or a specific inner element (apps that scroll a container instead of
 * the document — see `page-analyzer.ts`'s `findScrollRoot`).
 */
export class ScrollManager {
  private root: Window | HTMLElement = window;
  private rect: Rect = FULL_VIEWPORT_RECT;
  private originalScrollX = 0;
  private originalScrollY = 0;
  private captured = false;

  /** Call once per capture session, after determining what actually scrolls on this page. */
  captureOriginalPosition(root: Window | HTMLElement, rect: Rect): void {
    this.root = root;
    this.rect = rect;
    if (root === window) {
      this.originalScrollX = window.scrollX;
      this.originalScrollY = window.scrollY;
    } else {
      this.originalScrollX = (root as HTMLElement).scrollLeft;
      this.originalScrollY = (root as HTMLElement).scrollTop;
    }
    this.captured = true;
  }

  /**
   * Scrolls to `y`, then waits for the browser to settle: at minimum a scroll delay, images
   * currently in view finishing to load, and — if enabled — scroll-height stabilizing so
   * lazy-loaded/async content has a chance to render before the frame is captured.
   */
  async scrollTo(y: number, scrollDelayMs: number, waitForLazyContent: boolean): Promise<ScrollResult> {
    if (this.root === window) {
      window.scrollTo({ top: y, left: 0, behavior: "instant" as ScrollBehavior });
    } else {
      (this.root as HTMLElement).scrollTop = y;
    }

    const measure = this.root === window ? getDocumentHeight : () => (this.root as HTMLElement).scrollHeight;
    const imagesSettled = waitForImagesToSettle(this.rect, Math.min(scrollDelayMs * 3, 3000));

    if (waitForLazyContent) {
      const [documentHeight] = await Promise.all([
        waitForStableLayout(scrollDelayMs, scrollDelayMs * 2 + 400, measure),
        imagesSettled,
      ]);
      return { actualY: this.currentScrollTop(), documentHeight };
    }

    await Promise.all([sleep(scrollDelayMs), imagesSettled]);
    return { actualY: this.currentScrollTop(), documentHeight: measure() };
  }

  restoreOriginalPosition(): void {
    if (!this.captured) return;
    if (this.root === window) {
      window.scrollTo({
        top: this.originalScrollY,
        left: this.originalScrollX,
        behavior: "instant" as ScrollBehavior,
      });
    } else {
      const element = this.root as HTMLElement;
      element.scrollTop = this.originalScrollY;
      element.scrollLeft = this.originalScrollX;
    }
  }

  private currentScrollTop(): number {
    return this.root === window ? window.scrollY : (this.root as HTMLElement).scrollTop;
  }
}
