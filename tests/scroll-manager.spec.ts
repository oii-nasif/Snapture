// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScrollManager } from "../src/content/scroll-manager";

const FULL_RECT = { x: 0, y: 0, width: 1000, height: 800 };

// jsdom does not implement window.scrollTo (it logs "Not implemented" and leaves scrollY at 0),
// so we patch it to behave like a real browser for these tests: an implementation detail of the
// test environment, not something ScrollManager is expected to work around itself.
function patchWindowScroll(initialY = 0): void {
  let y = initialY;
  Object.defineProperty(window, "scrollY", { get: () => y, configurable: true });
  vi.spyOn(window, "scrollTo").mockImplementation(((...args: unknown[]) => {
    const first = args[0];
    if (first && typeof first === "object" && "top" in first) {
      y = (first as { top?: number }).top ?? y;
    } else if (typeof args[1] === "number") {
      y = args[1];
    }
  }) as typeof window.scrollTo);
}

describe("ScrollManager — window scrolling (ordinary pages)", () => {
  beforeEach(() => {
    patchWindowScroll(0);
  });

  it("scrolls the window and reports the resulting scrollY as actualY", async () => {
    Object.defineProperty(document.documentElement, "scrollHeight", { value: 5000, configurable: true });
    Object.defineProperty(document.body, "scrollHeight", { value: 5000, configurable: true });

    const manager = new ScrollManager();
    manager.captureOriginalPosition(window, FULL_RECT);
    const result = await manager.scrollTo(700, 20, false);

    expect(window.scrollY).toBe(700);
    expect(result.actualY).toBe(700);
    expect(result.documentHeight).toBe(5000);
  });

  it("restores the original window scroll position", async () => {
    window.scrollTo(0, 123);
    const manager = new ScrollManager();
    manager.captureOriginalPosition(window, FULL_RECT);

    await manager.scrollTo(900, 10, false);
    expect(window.scrollY).toBe(900);

    manager.restoreOriginalPosition();
    expect(window.scrollY).toBe(123);
  });

  it("does nothing on restore if captureOriginalPosition was never called", () => {
    const manager = new ScrollManager();
    expect(() => manager.restoreOriginalPosition()).not.toThrow();
  });
});

describe("ScrollManager — inner element scrolling (Confluence-style apps)", () => {
  it("scrolls the given element's scrollTop instead of the window", async () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "scrollHeight", { value: 4000, configurable: true });
    document.body.appendChild(container);

    const windowScrollSpy = vi.spyOn(window, "scrollTo");

    const manager = new ScrollManager();
    manager.captureOriginalPosition(container, { x: 0, y: 50, width: 1000, height: 750 });
    const result = await manager.scrollTo(600, 10, false);

    expect(container.scrollTop).toBe(600);
    expect(result.actualY).toBe(600);
    expect(result.documentHeight).toBe(4000);
    expect(windowScrollSpy).not.toHaveBeenCalled(); // must not touch window scroll at all
  });

  it("restores the element's original scrollTop/scrollLeft, not the window's", async () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "scrollHeight", { value: 4000, configurable: true });
    container.scrollTop = 42;
    container.scrollLeft = 7;
    document.body.appendChild(container);

    const manager = new ScrollManager();
    manager.captureOriginalPosition(container, { x: 0, y: 50, width: 1000, height: 750 });
    await manager.scrollTo(2000, 10, false);
    expect(container.scrollTop).toBe(2000);

    manager.restoreOriginalPosition();
    expect(container.scrollTop).toBe(42);
    expect(container.scrollLeft).toBe(7);
  });
});

describe("ScrollManager — waitForLazyContent floor behavior (regression guard)", () => {
  beforeEach(() => {
    patchWindowScroll(0);
  });

  it("honors the scrollDelayMs floor even when height never changes (the Confluence bug)", async () => {
    Object.defineProperty(document.documentElement, "scrollHeight", { value: 3000, configurable: true });
    Object.defineProperty(document.body, "scrollHeight", { value: 3000, configurable: true });

    const manager = new ScrollManager();
    manager.captureOriginalPosition(window, FULL_RECT);

    const start = Date.now();
    await manager.scrollTo(500, 250, true);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(230); // must not return after ~80ms like the old bug did
  });
});
