import type { ContentRequest, ContentResponse } from "@shared/messaging";
import type { PageMetrics } from "@shared/types";
import { findScrollRoot, getPageMetrics, waitForStableLayout } from "./page-analyzer";
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
        sendResponse({ type: "RESTORED" });
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
        stickyManager.freeze(scrollRoot.rect);
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
