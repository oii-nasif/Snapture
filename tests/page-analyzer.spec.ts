// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  findScrollRoot,
  getDocumentHeight,
  getDocumentWidth,
  waitForImagesToSettle,
  waitForStableLayout,
} from "../src/content/page-analyzer";

/** Overrides read-only layout getters on a single element/window so tests can simulate any
 *  geometry without a real layout engine (jsdom does no actual layout). */
function mockMetrics(
  target: Element | Window,
  values: Partial<Record<"scrollHeight" | "clientHeight" | "scrollWidth" | "clientWidth" | "innerWidth" | "innerHeight", number>>
): void {
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(target, key, { value, configurable: true });
  }
}

function mockRect(el: Element, rect: { x: number; y: number; width: number; height: number }): void {
  Object.defineProperty(el, "getBoundingClientRect", {
    value: () => ({
      x: rect.x,
      y: rect.y,
      top: rect.y,
      left: rect.x,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height,
      width: rect.width,
      height: rect.height,
      toJSON() {
        return this;
      },
    }),
    configurable: true,
  });
}

describe("getDocumentHeight / getDocumentWidth", () => {
  it("takes the max across body/documentElement metrics", () => {
    mockMetrics(document.body, { scrollHeight: 500, clientHeight: 300 });
    mockMetrics(document.documentElement, { scrollHeight: 800, clientHeight: 400 });
    expect(getDocumentHeight()).toBe(800);

    mockMetrics(document.body, { scrollWidth: 900, clientWidth: 300 });
    mockMetrics(document.documentElement, { scrollWidth: 700, clientWidth: 400 });
    expect(getDocumentWidth()).toBe(900);
  });
});

describe("findScrollRoot", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    mockMetrics(window, { innerWidth: 1000, innerHeight: 800 });
  });

  it("reports the document itself when it scrolls meaningfully more than the viewport", () => {
    mockMetrics(document.documentElement, { scrollHeight: 5000, clientHeight: 800 });
    mockMetrics(document.body, { scrollHeight: 5000 });

    const root = findScrollRoot();
    expect(root.isDocument).toBe(true);
    expect(root.element).toBeNull();
    expect(root.rect).toEqual({ x: 0, y: 0, width: 1000, height: 800 });
    expect(root.scrollHeight).toBe(5000);
  });

  it("finds an inner scroll container when the document itself does not scroll (Confluence-style apps)", () => {
    mockMetrics(document.documentElement, { scrollHeight: 800, clientHeight: 800 });
    mockMetrics(document.body, { scrollHeight: 800 });

    const container = document.createElement("div");
    container.style.overflowY = "auto";
    mockMetrics(container, { scrollHeight: 4000, clientHeight: 750 });
    mockRect(container, { x: 0, y: 50, width: 1000, height: 750 });
    document.body.appendChild(container);

    const root = findScrollRoot();
    expect(root.isDocument).toBe(false);
    expect(root.element).toBe(container);
    expect(root.rect).toEqual({ x: 0, y: 50, width: 1000, height: 750 });
    expect(root.scrollHeight).toBe(4000);
  });

  it("excludes the outer fixed chrome from the capture rect (clamped to the container's own bounds)", () => {
    mockMetrics(document.documentElement, { scrollHeight: 800, clientHeight: 800 });
    mockMetrics(document.body, { scrollHeight: 800 });

    const container = document.createElement("div");
    container.style.overflowY = "scroll";
    mockMetrics(container, { scrollHeight: 4000, clientHeight: 750 });
    // Container starts 50px down (below a fixed outer header) and is narrower than the viewport.
    mockRect(container, { x: 10, y: 50, width: 900, height: 750 });
    document.body.appendChild(container);

    const root = findScrollRoot();
    expect(root.rect).toEqual({ x: 10, y: 50, width: 900, height: 750 });
  });

  it("ignores scrollable elements too small to plausibly be the main content area", () => {
    mockMetrics(document.documentElement, { scrollHeight: 800, clientHeight: 800 });
    mockMetrics(document.body, { scrollHeight: 800 });

    const widget = document.createElement("div");
    widget.style.overflowY = "auto";
    mockMetrics(widget, { scrollHeight: 2000, clientHeight: 100 }); // tall excess, but tiny on screen
    mockRect(widget, { x: 0, y: 0, width: 150, height: 100 }); // well under 35% of 1000x800
    document.body.appendChild(widget);

    const root = findScrollRoot();
    expect(root.isDocument).toBe(true); // falls back — nothing qualifies
  });

  it("ignores scrollable elements that don't actually have much extra content", () => {
    mockMetrics(document.documentElement, { scrollHeight: 800, clientHeight: 800 });
    mockMetrics(document.body, { scrollHeight: 800 });

    const container = document.createElement("div");
    container.style.overflowY = "auto";
    mockMetrics(container, { scrollHeight: 820, clientHeight: 800 }); // only 20px of excess
    mockRect(container, { x: 0, y: 0, width: 1000, height: 800 });
    document.body.appendChild(container);

    const root = findScrollRoot();
    expect(root.isDocument).toBe(true);
  });

  it("ignores scrollable elements entirely outside the viewport", () => {
    mockMetrics(document.documentElement, { scrollHeight: 800, clientHeight: 800 });
    mockMetrics(document.body, { scrollHeight: 800 });

    const offscreen = document.createElement("div");
    offscreen.style.overflowY = "auto";
    mockMetrics(offscreen, { scrollHeight: 5000, clientHeight: 750 });
    mockRect(offscreen, { x: 0, y: 900, width: 1000, height: 750 }); // top >= viewportHeight

    document.body.appendChild(offscreen);

    const root = findScrollRoot();
    expect(root.isDocument).toBe(true);
  });

  it("picks the candidate with the largest on-screen footprint when several qualify", () => {
    mockMetrics(document.documentElement, { scrollHeight: 800, clientHeight: 800 });
    mockMetrics(document.body, { scrollHeight: 800 });

    const smaller = document.createElement("div");
    smaller.style.overflowY = "auto";
    mockMetrics(smaller, { scrollHeight: 2000, clientHeight: 700 });
    mockRect(smaller, { x: 0, y: 0, width: 400, height: 700 }); // area 280,000

    const bigger = document.createElement("div");
    bigger.style.overflowY = "auto";
    mockMetrics(bigger, { scrollHeight: 2000, clientHeight: 700 });
    mockRect(bigger, { x: 0, y: 0, width: 1000, height: 700 }); // area 700,000

    document.body.append(smaller, bigger);

    const root = findScrollRoot();
    expect(root.element).toBe(bigger);
  });

  it("regression: a small widget with a huge hidden scroll history must not outrank the real main content pane", () => {
    // This is the exact bug that produced an almost entirely blank capture in production: a
    // comment/chat widget can have a very large scrollHeight (a long hidden history) while only
    // occupying a small corner of the screen. Ranking by "most excess" let it hijack the whole
    // capture. Ranking by on-screen area (what this test guards) fixes it.
    mockMetrics(document.documentElement, { scrollHeight: 800, clientHeight: 800 });
    mockMetrics(document.body, { scrollHeight: 800 });

    const commentWidget = document.createElement("div");
    commentWidget.style.overflowY = "auto";
    mockMetrics(commentWidget, { scrollHeight: 50000, clientHeight: 200 }); // huge excess, tiny box
    mockRect(commentWidget, { x: 850, y: 700, width: 150, height: 100 }); // area 15,000 — fails the min-area bar entirely

    const mainContent = document.createElement("div");
    mainContent.style.overflowY = "auto";
    mockMetrics(mainContent, { scrollHeight: 4000, clientHeight: 750 }); // modest excess, dominates the screen
    mockRect(mainContent, { x: 0, y: 50, width: 1000, height: 750 }); // area 750,000

    document.body.append(commentWidget, mainContent);

    const root = findScrollRoot();
    expect(root.element).toBe(mainContent);
    expect(root.scrollHeight).toBe(4000);
  });

  it("falls back to the full viewport when nothing scrollable exists at all", () => {
    mockMetrics(document.documentElement, { scrollHeight: 800, clientHeight: 800 });
    mockMetrics(document.body, { scrollHeight: 800 });

    const root = findScrollRoot();
    expect(root).toEqual({
      isDocument: true,
      element: null,
      rect: { x: 0, y: 0, width: 1000, height: 800 },
      scrollWidth: expect.any(Number),
      scrollHeight: 800,
    });
  });
});

describe("waitForImagesToSettle", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  function makeImage(complete: boolean, rect: { x: number; y: number; width: number; height: number }): HTMLImageElement {
    const img = document.createElement("img");
    Object.defineProperty(img, "complete", { value: complete, configurable: true });
    mockRect(img, rect);
    document.body.appendChild(img);
    return img;
  }

  it("resolves immediately when there is nothing pending in the given rect", async () => {
    makeImage(true, { x: 0, y: 0, width: 100, height: 100 });
    const start = Date.now();
    await waitForImagesToSettle({ x: 0, y: 0, width: 1000, height: 800 }, 5000);
    expect(Date.now() - start).toBeLessThan(50);
  });

  it("ignores images outside the given rect even if incomplete", async () => {
    makeImage(false, { x: 2000, y: 2000, width: 100, height: 100 });
    const start = Date.now();
    await waitForImagesToSettle({ x: 0, y: 0, width: 1000, height: 800 }, 5000);
    expect(Date.now() - start).toBeLessThan(50);
  });

  it("waits for an incomplete image in view to fire load before resolving", async () => {
    const img = makeImage(false, { x: 0, y: 0, width: 100, height: 100 });
    let resolved = false;
    const promise = waitForImagesToSettle({ x: 0, y: 0, width: 1000, height: 800 }, 5000).then(() => {
      resolved = true;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(resolved).toBe(false); // still pending — image hasn't loaded yet
    img.dispatchEvent(new Event("load"));
    await promise;
    expect(resolved).toBe(true);
  });

  it("treats an image error event as settled too (don't hang on a broken image)", async () => {
    const img = makeImage(false, { x: 0, y: 0, width: 100, height: 100 });
    const promise = waitForImagesToSettle({ x: 0, y: 0, width: 1000, height: 800 }, 5000);
    img.dispatchEvent(new Event("error"));
    await expect(promise).resolves.toBeUndefined();
  });

  it("gives up after maxWaitMs if an image never settles, instead of hanging forever", async () => {
    makeImage(false, { x: 0, y: 0, width: 100, height: 100 }); // never dispatches load/error
    const start = Date.now();
    await waitForImagesToSettle({ x: 0, y: 0, width: 1000, height: 800 }, 100);
    expect(Date.now() - start).toBeGreaterThanOrEqual(95);
    expect(Date.now() - start).toBeLessThan(400);
  });
});

describe("waitForStableLayout", () => {
  it("never returns before minWaitMs even when the measurement never changes", async () => {
    const measure = () => 1234; // height that "never changes" — the exact Confluence scenario
    const start = Date.now();
    const result = await waitForStableLayout(300, 300, measure);
    const elapsed = Date.now() - start;
    expect(result).toBe(1234);
    expect(elapsed).toBeGreaterThanOrEqual(280); // small tolerance for rAF/timer scheduling
  });

  it("extends past minWaitMs while the measurement keeps changing, up to maxWaitMs", async () => {
    let calls = 0;
    const measure = () => {
      calls += 1;
      return calls < 6 ? calls : 999; // keeps changing for a while, then settles at 999
    };
    const result = await waitForStableLayout(50, 2000, measure);
    expect(result).toBe(999);
  });

  it("gives up at maxWaitMs and returns the last value if it never stabilizes", async () => {
    const measure = () => Date.now(); // "always changing"
    const start = Date.now();
    const result = await waitForStableLayout(50, 250, measure);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(230);
    expect(elapsed).toBeLessThan(600);
    expect(typeof result).toBe("number");
  });
});
