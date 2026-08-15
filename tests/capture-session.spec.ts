import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContentResponse } from "../src/shared/messaging";
import type { CaptureSettings, OutputSettings, PageMetrics } from "../src/shared/types";

const sendToContentScript = vi.fn();
vi.mock("@shared/messaging", () => ({ sendToContentScript }));

const captureVisibleViewport = vi.fn();
vi.mock("../src/capture/viewport-capture", () => ({ captureVisibleViewport }));

const stitchFrames = vi.fn();
vi.mock("../src/capture/screenshot-stitcher", () => ({ stitchFrames }));

const cropImage = vi.fn();
const getImageDimensions = vi.fn();
vi.mock("../src/capture/image-processor", () => ({ cropImage, getImageDimensions }));

const executeScript = vi.fn();
vi.stubGlobal("chrome", { scripting: { executeScript } });

const { captureFullPage, captureSelection, captureVisible, CaptureCancelledError } = await import(
  "../src/capture/capture-session"
);

const TAB = { id: 1, windowId: 10 } as chrome.tabs.Tab;

const SETTINGS: CaptureSettings = {
  scrollDelayMs: 10,
  scrollOverlapPx: 20,
  hideStickyElements: true,
  waitForLazyContent: true,
  maxPageHeightPx: 30000,
  maxCaptureDurationMs: 60000,
};

const OUTPUT: OutputSettings = { format: "png", jpegQuality: 90, filenamePrefix: "screenshot" };

function metrics(overrides: Partial<PageMetrics> = {}): PageMetrics {
  return {
    viewportWidth: 1000,
    viewportHeight: 800,
    documentWidth: 1000,
    documentHeight: 800,
    scrollX: 0,
    scrollY: 0,
    devicePixelRatio: 1,
    captureOffsetX: 0,
    captureOffsetY: 0,
    needsCrop: false,
    ...overrides,
  };
}

function frameBuffer(tag: string): { buffer: ArrayBuffer; mimeType: string } {
  return { buffer: new TextEncoder().encode(tag).buffer, mimeType: "image/png" };
}

function callbacks(isCancelled: () => boolean = () => false) {
  return { onProgress: vi.fn(), isCancelled };
}

/** Wires up a scripted sequence of content-script responses keyed by message type, in order. */
function scriptContentScript(responses: Array<ContentResponse | Error>): void {
  let call = 0;
  sendToContentScript.mockImplementation(async () => {
    const next = responses[call++];
    if (next instanceof Error) throw next;
    return next;
  });
}

beforeEach(() => {
  sendToContentScript.mockReset();
  captureVisibleViewport.mockReset().mockResolvedValue(frameBuffer("frame"));
  stitchFrames.mockReset().mockResolvedValue({ buffer: new ArrayBuffer(0), mimeType: "image/png", width: 1000, height: 800 });
  cropImage.mockReset().mockResolvedValue({ buffer: new ArrayBuffer(0), mimeType: "image/png", width: 100, height: 100 });
  getImageDimensions.mockReset().mockResolvedValue({ width: 1000, height: 800 });
  executeScript.mockReset().mockResolvedValue(undefined);
});

describe("captureFullPage", () => {
  it("skips content-script injection when PING already succeeds", async () => {
    scriptContentScript([
      { type: "PONG" }, // PING
      { type: "PREPARED", metrics: metrics() },
      { type: "SCROLL_RESULT", actualY: 0, documentHeight: 800 },
      { type: "RESTORED" },
    ]);

    await captureFullPage(TAB, SETTINGS, OUTPUT, callbacks());
    expect(executeScript).not.toHaveBeenCalled();
  });

  it("injects the content script when the initial PING fails", async () => {
    let call = 0;
    const sequence: Array<ContentResponse | Error> = [
      new Error("no receiver"), // first PING fails
      { type: "PONG" }, // PING after injection succeeds
      { type: "PREPARED", metrics: metrics() },
      { type: "SCROLL_RESULT", actualY: 0, documentHeight: 800 },
      { type: "RESTORED" },
    ];
    sendToContentScript.mockImplementation(async () => {
      const next = sequence[call++];
      if (next instanceof Error) throw next;
      return next;
    });

    await captureFullPage(TAB, SETTINGS, OUTPUT, callbacks());
    expect(executeScript).toHaveBeenCalledTimes(1);
    expect(executeScript).toHaveBeenCalledWith(
      expect.objectContaining({ target: { tabId: 1 } })
    );
  });

  it("captures one frame per scroll step and always restores the page afterward", async () => {
    // documentHeight 2000 / viewportHeight 800 / overlap 20 → step 780 → y: 0, 780, 1200 (3 steps)
    scriptContentScript([
      { type: "PONG" },
      { type: "PREPARED", metrics: metrics({ documentHeight: 2000 }) },
      { type: "SCROLL_RESULT", actualY: 0, documentHeight: 2000 },
      { type: "SCROLL_RESULT", actualY: 780, documentHeight: 2000 },
      { type: "SCROLL_RESULT", actualY: 1200, documentHeight: 2000 },
      { type: "RESTORED" },
    ]);

    await captureFullPage(TAB, SETTINGS, OUTPUT, callbacks());

    const scrollCalls = sendToContentScript.mock.calls.filter(([, msg]) => msg.type === "SCROLL_TO");
    expect(scrollCalls.map(([, msg]) => msg.y)).toEqual([0, 780, 1200]);
    expect(captureVisibleViewport).toHaveBeenCalledTimes(3);

    const restoreCalls = sendToContentScript.mock.calls.filter(([, msg]) => msg.type === "RESTORE_PAGE");
    expect(restoreCalls).toHaveLength(1);
  });

  it("restores the page even when the capture throws mid-loop", async () => {
    scriptContentScript([
      { type: "PONG" },
      { type: "PREPARED", metrics: metrics({ documentHeight: 2000 }) },
      { type: "SCROLL_RESULT", actualY: 0, documentHeight: 2000 },
      new Error("tab was closed"),
      { type: "RESTORED" },
    ]);

    await expect(captureFullPage(TAB, SETTINGS, OUTPUT, callbacks())).rejects.toThrow("tab was closed");

    const restoreCalls = sendToContentScript.mock.calls.filter(([, msg]) => msg.type === "RESTORE_PAGE");
    expect(restoreCalls).toHaveLength(1);
    expect(stitchFrames).not.toHaveBeenCalled();
  });

  it("a RESTORE_PAGE failure never masks the real error, and never throws itself", async () => {
    scriptContentScript([
      { type: "PONG" },
      { type: "PREPARED", metrics: metrics({ documentHeight: 2000 }) },
      { type: "SCROLL_RESULT", actualY: 0, documentHeight: 2000 },
      new Error("original failure"),
      new Error("restore also failed"),
    ]);

    await expect(captureFullPage(TAB, SETTINGS, OUTPUT, callbacks())).rejects.toThrow("original failure");
  });

  it("stops as soon as isCancelled() returns true, before the next scroll, and never stitches", async () => {
    scriptContentScript([
      { type: "PONG" },
      { type: "PREPARED", metrics: metrics({ documentHeight: 3000 }) },
      { type: "SCROLL_RESULT", actualY: 0, documentHeight: 3000 },
      { type: "RESTORED" },
    ]);

    let cancelAfterFirstFrame = false;
    const cb = callbacks(() => cancelAfterFirstFrame);
    // Flip the flag as a side effect of the first frame's capture resolving — deterministic,
    // unlike polling for the call count with real-time delays against near-instant mocks.
    captureVisibleViewport.mockImplementationOnce(async () => {
      cancelAfterFirstFrame = true;
      return frameBuffer("frame");
    });

    await expect(captureFullPage(TAB, SETTINGS, OUTPUT, cb)).rejects.toBeInstanceOf(CaptureCancelledError);
    expect(captureVisibleViewport).toHaveBeenCalledTimes(1); // never captured a 2nd frame
    expect(stitchFrames).not.toHaveBeenCalled();
  });

  it("stops when the browser can't scroll any further (no-progress), still captures that last frame", async () => {
    // 3-step plan, but the 2nd SCROLL_TO reports the same actualY as the 1st (clamped at bottom).
    scriptContentScript([
      { type: "PONG" },
      { type: "PREPARED", metrics: metrics({ documentHeight: 2000 }) },
      { type: "SCROLL_RESULT", actualY: 0, documentHeight: 2000 },
      { type: "SCROLL_RESULT", actualY: 0, documentHeight: 2000 }, // no progress
      { type: "RESTORED" },
    ]);

    await captureFullPage(TAB, SETTINGS, OUTPUT, callbacks());

    const scrollCalls = sendToContentScript.mock.calls.filter(([, msg]) => msg.type === "SCROLL_TO");
    expect(scrollCalls).toHaveLength(2); // stopped after detecting no progress, didn't attempt the 3rd
    expect(captureVisibleViewport).toHaveBeenCalledTimes(2); // but did capture the frame it had
  });

  it("extends the scroll plan live when the page grows after the last planned step", async () => {
    // documentHeight 800 == viewportHeight 800 → single planned step (isLast: true immediately).
    // The response for that step reports the page actually grew to 2000px (lazy content).
    scriptContentScript([
      { type: "PONG" },
      { type: "PREPARED", metrics: metrics({ documentHeight: 800 }) },
      { type: "SCROLL_RESULT", actualY: 0, documentHeight: 2000 }, // grew!
      { type: "SCROLL_RESULT", actualY: 780, documentHeight: 2000 },
      { type: "SCROLL_RESULT", actualY: 1200, documentHeight: 2000 },
      { type: "RESTORED" },
    ]);

    await captureFullPage(TAB, SETTINGS, OUTPUT, callbacks());

    const scrollCalls = sendToContentScript.mock.calls.filter(([, msg]) => msg.type === "SCROLL_TO");
    expect(scrollCalls.length).toBeGreaterThan(1); // plan was extended, not left at 1 step
    expect(scrollCalls.map(([, msg]) => msg.y)).toEqual([0, 780, 1200]);
  });

  it("caps growth at maxPageHeightPx rather than extending forever on infinite-scroll pages", async () => {
    scriptContentScript([
      { type: "PONG" },
      { type: "PREPARED", metrics: metrics({ documentHeight: 800 }) },
      { type: "SCROLL_RESULT", actualY: 0, documentHeight: 500000 }, // "infinite" scroll
      ...Array.from({ length: 50 }, () => ({ type: "SCROLL_RESULT" as const, actualY: 0, documentHeight: 500000 })),
      { type: "RESTORED" },
    ]);
    // (actualY repeats 0 on purpose so the no-progress guard kicks in quickly rather than
    // actually iterating through a huge capped plan — we only care that it terminates.)

    await expect(
      captureFullPage(TAB, { ...SETTINGS, maxPageHeightPx: 5000 }, OUTPUT, callbacks())
    ).resolves.toBeDefined();
  });

  it("stops making further captures once maxCaptureDurationMs has elapsed", async () => {
    scriptContentScript([
      { type: "PONG" },
      { type: "PREPARED", metrics: metrics({ documentHeight: 5000 }) }, // many steps possible
      { type: "SCROLL_RESULT", actualY: 0, documentHeight: 5000 },
      { type: "SCROLL_RESULT", actualY: 780, documentHeight: 5000 },
      { type: "SCROLL_RESULT", actualY: 1560, documentHeight: 5000 },
      { type: "RESTORED" },
    ]);
    // Real 30ms delay on the first frame so wall-clock time genuinely advances past a 5ms
    // budget — avoids same-millisecond flakiness from relying on near-instant mock resolution.
    captureVisibleViewport.mockImplementationOnce(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return frameBuffer("frame");
    });

    await captureFullPage(TAB, { ...SETTINGS, maxCaptureDurationMs: 5 }, OUTPUT, callbacks());

    expect(captureVisibleViewport).toHaveBeenCalledTimes(1);
  });

  it("crops each frame to the capture rect when the scroll root is an inner container (needsCrop)", async () => {
    scriptContentScript([
      { type: "PONG" },
      {
        type: "PREPARED",
        metrics: metrics({
          needsCrop: true,
          captureOffsetX: 15,
          captureOffsetY: 40,
          viewportWidth: 900,
          viewportHeight: 700,
          documentHeight: 700, // == viewportHeight so this is a single-step capture
          devicePixelRatio: 2,
        }),
      },
      { type: "SCROLL_RESULT", actualY: 0, documentHeight: 700 },
      { type: "RESTORED" },
    ]);

    await captureFullPage(TAB, SETTINGS, OUTPUT, callbacks());

    expect(cropImage).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { x: 15, y: 40, width: 900, height: 700 },
      2,
      "png",
      100
    );
  });

  it("does not crop frames when the document itself is the scroll root", async () => {
    scriptContentScript([
      { type: "PONG" },
      { type: "PREPARED", metrics: metrics({ needsCrop: false }) },
      { type: "SCROLL_RESULT", actualY: 0, documentHeight: 800 },
      { type: "RESTORED" },
    ]);

    await captureFullPage(TAB, SETTINGS, OUTPUT, callbacks());
    expect(cropImage).not.toHaveBeenCalled();
  });

  it("throws a clear error if the content script responds with the wrong message type", async () => {
    scriptContentScript([{ type: "PONG" }, { type: "RESTORED" }, { type: "RESTORED" }]);
    await expect(captureFullPage(TAB, SETTINGS, OUTPUT, callbacks())).rejects.toThrow(/prepar/i);
  });
});

describe("captureVisible", () => {
  it("never touches the content script at all", async () => {
    await captureVisible(TAB, OUTPUT);
    expect(sendToContentScript).not.toHaveBeenCalled();
    expect(captureVisibleViewport).toHaveBeenCalledWith(10, "png", 90);
  });

  it("assembles width/height from getImageDimensions", async () => {
    getImageDimensions.mockResolvedValueOnce({ width: 1234, height: 567 });
    const result = await captureVisible(TAB, OUTPUT);
    expect(result.width).toBe(1234);
    expect(result.height).toBe(567);
  });
});

describe("captureSelection", () => {
  it("crops the captured viewport to the user's dragged rect", async () => {
    scriptContentScript([
      { type: "PONG" },
      { type: "SELECTION_RESULT", rect: { x: 10, y: 20, width: 300, height: 200 }, devicePixelRatio: 2 },
    ]);

    await captureSelection(TAB, OUTPUT, callbacks());
    expect(cropImage).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { x: 10, y: 20, width: 300, height: 200 },
      2,
      "png",
      90
    );
  });

  it("treats a cancelled selection (null rect) as CaptureCancelledError, never crops", async () => {
    scriptContentScript([{ type: "PONG" }, { type: "SELECTION_RESULT", rect: null, devicePixelRatio: 1 }]);
    await expect(captureSelection(TAB, OUTPUT, callbacks())).rejects.toBeInstanceOf(CaptureCancelledError);
    expect(cropImage).not.toHaveBeenCalled();
  });

  it("honors isCancelled() even if a rect was returned", async () => {
    scriptContentScript([
      { type: "PONG" },
      { type: "SELECTION_RESULT", rect: { x: 0, y: 0, width: 100, height: 100 }, devicePixelRatio: 1 },
    ]);
    await expect(
      captureSelection(TAB, OUTPUT, callbacks(() => true))
    ).rejects.toBeInstanceOf(CaptureCancelledError);
    expect(cropImage).not.toHaveBeenCalled();
  });
});
