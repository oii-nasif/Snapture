import type { ContentRequest, ContentResponse } from "@shared/messaging";
import type { PageMetrics } from "@shared/types";
import { findScrollRoot, getPageMetrics, waitForNextPaint, waitForStableLayout } from "./page-analyzer";
import { ScrollManager } from "./scroll-manager";
import { SelectionManager } from "./selection-manager";
import { StickyElementManager } from "./sticky-element-manager";

const scrollManager = new ScrollManager();
const stickyManager = new StickyElementManager();
const selectionManager = new SelectionManager();

/** Registers the single message listener this content script uses to talk to the background worker. */
export function initCaptureController(): void {
  chrome.runtime.onMessage.addListener((message: ContentRequest, _sender, sendResponse) => {
    handleMessage(message)
      .then(sendResponse)
      .catch((error: unknown) => {
        console.error("[Snapture] content script error:", error);
        sendResponse({
          type: "CONTENT_ERROR",
          message: error instanceof Error ? error.message : String(error),
        });
      });
    return true;
  });
}

async function handleMessage(message: ContentRequest): Promise<ContentResponse> {
  switch (message.type) {
    case "PING":
      return { type: "PONG" };

    case "ANALYZE_PAGE":
      return { type: "PAGE_METRICS", metrics: getPageMetrics() };

    case "PREPARE_CAPTURE": {
      // Give the page a moment to finish its initial render/hydration before we so much as look
      // for what scrolls — scanning mid-hydration can both mis-measure the document height and
      // mis-detect the scroll container (a still-settling SPA can transiently look like it has
      // no real scrollable content yet).
      if (message.waitForLazyContent) {
        await waitForStableLayout(message.scrollDelayMs, message.scrollDelayMs * 2 + 400);
      }

      const scrollRoot = findScrollRoot();
      scrollManager.captureOriginalPosition(
        scrollRoot.isDocument ? window : scrollRoot.element!,
        scrollRoot.rect
      );
      if (message.hideSticky) {
        stickyManager.freeze(scrollRoot.rect, scrollRoot.isDocument ? null : scrollRoot.element);

        // Probe scrolls: JavaScript-pinned elements (cloned sticky table headers, transform-
        // pinned widgets) only reveal themselves by NOT moving while the page scrolls. Two
        // quick observation scrolls before any frame is captured let movement-based detection
        // identify them up front, so they get exactly one legitimate appearance instead of
        // leaking into the first frame or two. The capture loop's own first SCROLL_TO returns
        // the page to the top, and RESTORE_PAGE puts the user's position back at the end.
        const PROBE_DELAY_MS = 220;
        const MIN_PROBE_DELTA_PX = 40;
        const maxScroll = scrollRoot.scrollHeight - scrollRoot.rect.height;
        const step = Math.round(scrollRoot.rect.height * 0.6);
        if (maxScroll >= MIN_PROBE_DELTA_PX && step > 0) {
          const firstProbe = await scrollManager.scrollTo(Math.min(step, maxScroll), PROBE_DELAY_MS, false);
          stickyManager.observe(firstProbe.actualY);
          const secondTarget = Math.min(firstProbe.actualY + step, maxScroll);
          if (Math.abs(secondTarget - firstProbe.actualY) >= MIN_PROBE_DELTA_PX) {
            const secondProbe = await scrollManager.scrollTo(secondTarget, PROBE_DELAY_MS, false);
            stickyManager.observe(secondProbe.actualY);
          }
        }
      }

      const fullViewportWidth = window.innerWidth;
      const fullViewportHeight = window.innerHeight;
      const metrics: PageMetrics = {
        viewportWidth: scrollRoot.rect.width,
        viewportHeight: scrollRoot.rect.height,
        documentWidth: scrollRoot.scrollWidth,
        documentHeight: scrollRoot.scrollHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        devicePixelRatio: window.devicePixelRatio || 1,
        captureOffsetX: scrollRoot.rect.x,
        captureOffsetY: scrollRoot.rect.y,
        needsCrop: !(
          scrollRoot.rect.x === 0 &&
          scrollRoot.rect.y === 0 &&
          scrollRoot.rect.width === fullViewportWidth &&
          scrollRoot.rect.height === fullViewportHeight
        ),
      };
      return { type: "PREPARED", metrics };
    }

    case "SCROLL_TO": {
      stickyManager.applyForFrame(message.isFirst, message.isLast);
      const result = await scrollManager.scrollTo(
        message.y,
        message.scrollDelayMs,
        message.waitForLazyContent
      );
      // Re-apply after the settle wait: apps mount floating UI in response to the new scroll
      // position (cloned sticky table headers, lazy toolbars) — those only exist now, and the
      // frame is captured immediately after this response is sent. Passing the settled scroll
      // offset enables movement-based pinned-element detection. Then wait for a committed
      // paint, or the capture can race the compositor and still show the just-hidden elements.
      stickyManager.applyForFrame(message.isFirst, message.isLast, result.actualY);
      await waitForNextPaint();
      return {
        type: "SCROLL_RESULT",
        actualY: result.actualY,
        documentHeight: result.documentHeight,
      };
    }

    case "RESTORE_PAGE": {
      stickyManager.restore();
      scrollManager.restoreOriginalPosition();
      return { type: "RESTORED" };
    }

    case "START_SELECTION": {
      const rect = await selectionManager.start();
      // Wait for a committed paint after the overlay is torn down, or the capture that fires
      // as soon as this response lands can still show the dimmed backdrop and toolbar.
      await waitForNextPaint();
      return { type: "SELECTION_RESULT", rect, devicePixelRatio: window.devicePixelRatio || 1 };
    }

    case "CANCEL_SELECTION": {
      selectionManager.cancel();
      return { type: "SELECTION_RESULT", rect: null, devicePixelRatio: window.devicePixelRatio || 1 };
    }

    default: {
      const exhaustiveCheck: never = message;
      throw new Error(`Unhandled content message: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}
