// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { StickyElementManager } from "../src/content/sticky-element-manager";

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

function makeStickyEl(position: "fixed" | "sticky", rect: { x: number; y: number; width: number; height: number }): HTMLElement {
  const el = document.createElement("div");
  el.style.position = position;
  mockRect(el, rect);
  document.body.appendChild(el);
  return el;
}

describe("StickyElementManager", () => {
  const captureRect = { x: 0, y: 0, width: 1000, height: 800 };

  beforeEach(() => {
    document.body.innerHTML = "";
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
  });

  it("classifies a fixed header near the top and a fixed footer near the bottom", () => {
    const header = makeStickyEl("fixed", { x: 0, y: 0, width: 1000, height: 60 });
    const footer = makeStickyEl("fixed", { x: 0, y: 740, width: 1000, height: 60 });

    const manager = new StickyElementManager();
    const count = manager.freeze(captureRect);
    expect(count).toBe(2);

    // First frame: header visible, footer hidden.
    manager.applyForFrame(true, false);
    expect(header.style.visibility).toBe("");
    expect(footer.style.visibility).toBe("hidden");

    // Middle frame: both hidden.
    manager.applyForFrame(false, false);
    expect(header.style.visibility).toBe("hidden");
    expect(footer.style.visibility).toBe("hidden");

    // Last frame: footer visible, header hidden.
    manager.applyForFrame(false, true);
    expect(header.style.visibility).toBe("hidden");
    expect(footer.style.visibility).toBe("");
  });

  it("treats position: sticky the same as position: fixed", () => {
    const stickyHeader = makeStickyEl("sticky", { x: 0, y: 0, width: 1000, height: 60 });
    const manager = new StickyElementManager();
    expect(manager.freeze(captureRect)).toBe(1);
    manager.applyForFrame(false, false);
    expect(stickyHeader.style.visibility).toBe("hidden");
  });

  it("classifies relative to the capture rect, not the whole browser viewport", () => {
    // An inner-scroll-container capture whose rect starts 200px down the real viewport — an
    // element sitting at the container's own top (y=210) should be "top", not "bottom", even
    // though 210 is well above the *browser* viewport's midpoint of 400.
    const innerRect = { x: 0, y: 200, width: 1000, height: 600 }; // midpoint = 500
    const nearContainerTop = makeStickyEl("fixed", { x: 0, y: 210, width: 1000, height: 40 });

    const manager = new StickyElementManager();
    manager.freeze(innerRect);
    manager.applyForFrame(true, false);
    expect(nearContainerTop.style.visibility).toBe(""); // classified "top" relative to innerRect
  });

  it("never touches elements that are already invisible", () => {
    const hiddenViaVisibility = makeStickyEl("fixed", { x: 0, y: 0, width: 1000, height: 60 });
    hiddenViaVisibility.style.visibility = "hidden";
    const hiddenViaDisplay = makeStickyEl("fixed", { x: 0, y: 100, width: 1000, height: 60 });
    hiddenViaDisplay.style.display = "none";

    const manager = new StickyElementManager();
    expect(manager.freeze(captureRect)).toBe(0);
  });

  it("ignores zero-size elements", () => {
    makeStickyEl("fixed", { x: 0, y: 0, width: 0, height: 0 });
    const manager = new StickyElementManager();
    expect(manager.freeze(captureRect)).toBe(0);
  });

  it("ignores elements entirely outside the current viewport", () => {
    makeStickyEl("fixed", { x: 0, y: 900, width: 1000, height: 60 }); // top > innerHeight(800)
    const manager = new StickyElementManager();
    expect(manager.freeze(captureRect)).toBe(0);
  });

  it("regression: never hides a tall sticky layout wrapper that contains the page content", () => {
    // This is the bug that produced completely blank captures on Confluence: the main content
    // column sits inside a position:sticky/fixed layout wrapper. Classifying it as a
    // header/footer and hiding it during middle frames blanked the whole page. Anything taller
    // than 30% of the capture area must be left alone.
    const contentWrapper = makeStickyEl("sticky", { x: 0, y: 50, width: 1000, height: 750 });

    const manager = new StickyElementManager();
    expect(manager.freeze(captureRect)).toBe(0);

    manager.applyForFrame(false, false); // middle frame — previously this blanked everything
    expect(contentWrapper.style.visibility).toBe("");
  });

  it("regression: never hides a short sticky wrapper whose subtree holds tall overflowing content", () => {
    // visibility:hidden on a wrapper blanks all descendants, so a 50px-tall sticky positioner
    // whose children hold the real 5000px page body is just as dangerous as a tall one.
    const shortWrapper = makeStickyEl("sticky", { x: 0, y: 0, width: 1000, height: 50 });
    Object.defineProperty(shortWrapper, "scrollHeight", { value: 5000, configurable: true });

    const manager = new StickyElementManager();
    expect(manager.freeze(captureRect)).toBe(0);
  });

  it("still hides a genuinely short sticky header (30% cap doesn't overreach)", () => {
    const header = makeStickyEl("fixed", { x: 0, y: 0, width: 1000, height: 200 }); // 25% of 800

    const manager = new StickyElementManager();
    expect(manager.freeze(captureRect)).toBe(1);
    manager.applyForFrame(false, false);
    expect(header.style.visibility).toBe("hidden");
  });

  it("ignores static/relative positioned elements — only fixed/sticky are candidates", () => {
    const normalEl = document.createElement("div");
    normalEl.style.position = "relative";
    mockRect(normalEl, { x: 0, y: 0, width: 1000, height: 60 });
    document.body.appendChild(normalEl);

    const manager = new StickyElementManager();
    expect(manager.freeze(captureRect)).toBe(0);
  });

  it("skips the selection overlay and its descendants entirely", () => {
    const overlay = document.createElement("div");
    overlay.setAttribute("data-fps-overlay", "true");
    overlay.style.position = "fixed";
    mockRect(overlay, { x: 0, y: 0, width: 1000, height: 800 });

    const child = document.createElement("button");
    child.style.position = "fixed";
    mockRect(child, { x: 10, y: 10, width: 40, height: 20 });
    overlay.appendChild(child);
    document.body.appendChild(overlay);

    const manager = new StickyElementManager();
    expect(manager.freeze(captureRect)).toBe(0);
  });

  it("restore() reverts every mutated element back to its original inline style", () => {
    const header = makeStickyEl("fixed", { x: 0, y: 0, width: 1000, height: 60 });
    header.style.setProperty("color", "red"); // some pre-existing inline style to preserve
    const originalCssText = header.style.cssText;

    const manager = new StickyElementManager();
    manager.freeze(captureRect);
    manager.applyForFrame(false, false);
    expect(header.style.visibility).toBe("hidden");
    expect(header.hasAttribute("data-fps-frozen")).toBe(true);

    manager.restore();
    expect(header.style.cssText).toBe(originalCssText);
    expect(header.hasAttribute("data-fps-frozen")).toBe(false);
  });

  it("applyForFrame is a no-op after restore() (nothing left tracked, not active)", () => {
    const header = makeStickyEl("fixed", { x: 0, y: 0, width: 1000, height: 60 });
    const manager = new StickyElementManager();
    manager.freeze(captureRect);
    manager.restore();

    manager.applyForFrame(true, false); // must not throw, must not touch the element
    expect(header.style.visibility).toBe("");
  });

  it("a second freeze() call starts fresh rather than accumulating previously tracked elements", () => {
    const first = makeStickyEl("fixed", { x: 0, y: 0, width: 1000, height: 60 });
    const manager = new StickyElementManager();
    expect(manager.freeze(captureRect)).toBe(1);

    document.body.removeChild(first);
    const second = makeStickyEl("fixed", { x: 0, y: 0, width: 1000, height: 60 });
    expect(manager.freeze(captureRect)).toBe(1);

    manager.applyForFrame(false, false);
    expect(second.style.visibility).toBe("hidden");
  });
});
