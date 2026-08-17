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
    const count = manager.freeze(captureRect, null);
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
    expect(manager.freeze(captureRect, null)).toBe(1);
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
    manager.freeze(innerRect, null);
    manager.applyForFrame(true, false);
    expect(nearContainerTop.style.visibility).toBe(""); // classified "top" relative to innerRect
  });

  it("never touches elements that are already invisible", () => {
    const hiddenViaVisibility = makeStickyEl("fixed", { x: 0, y: 0, width: 1000, height: 60 });
    hiddenViaVisibility.style.visibility = "hidden";
    const hiddenViaDisplay = makeStickyEl("fixed", { x: 0, y: 100, width: 1000, height: 60 });
    hiddenViaDisplay.style.display = "none";

    const manager = new StickyElementManager();
    expect(manager.freeze(captureRect, null)).toBe(0);
  });

  it("ignores zero-size elements", () => {
    makeStickyEl("fixed", { x: 0, y: 0, width: 0, height: 0 });
    const manager = new StickyElementManager();
    expect(manager.freeze(captureRect, null)).toBe(0);
  });

  it("ignores elements entirely outside the current viewport", () => {
    makeStickyEl("fixed", { x: 0, y: 900, width: 1000, height: 60 }); // top > innerHeight(800)
    const manager = new StickyElementManager();
    expect(manager.freeze(captureRect, null)).toBe(0);
  });

  it("regression: never hides a tall sticky layout wrapper that contains the page content", () => {
    // This is the bug that produced completely blank captures on Confluence: the main content
    // column sits inside a position:sticky/fixed layout wrapper. Classifying it as a
    // header/footer and hiding it during middle frames blanked the whole page. Anything taller
    // than 30% of the capture area must be left alone.
    const contentWrapper = makeStickyEl("sticky", { x: 0, y: 50, width: 1000, height: 750 });

    const manager = new StickyElementManager();
    expect(manager.freeze(captureRect, null)).toBe(0);

    manager.applyForFrame(false, false); // middle frame — previously this blanked everything
    expect(contentWrapper.style.visibility).toBe("");
  });

  it("regression: never hides a short sticky wrapper whose subtree holds tall overflowing content", () => {
    // visibility:hidden on a wrapper blanks all descendants, so a 50px-tall sticky positioner
    // whose children hold the real 5000px page body is just as dangerous as a tall one.
    const shortWrapper = makeStickyEl("sticky", { x: 0, y: 0, width: 1000, height: 50 });
    Object.defineProperty(shortWrapper, "scrollHeight", { value: 5000, configurable: true });

    const manager = new StickyElementManager();
    expect(manager.freeze(captureRect, null)).toBe(0);
  });

  it("still hides a genuinely short sticky header (30% cap doesn't overreach)", () => {
    const header = makeStickyEl("fixed", { x: 0, y: 0, width: 1000, height: 200 }); // 25% of 800

    const manager = new StickyElementManager();
    expect(manager.freeze(captureRect, null)).toBe(1);
    manager.applyForFrame(false, false);
    expect(header.style.visibility).toBe("hidden");
  });

  it("ignores static/relative positioned elements — only fixed/sticky are candidates", () => {
    const normalEl = document.createElement("div");
    normalEl.style.position = "relative";
    mockRect(normalEl, { x: 0, y: 0, width: 1000, height: 60 });
    document.body.appendChild(normalEl);

    const manager = new StickyElementManager();
    expect(manager.freeze(captureRect, null)).toBe(0);
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
    expect(manager.freeze(captureRect, null)).toBe(0);
  });

  it("regression: hides absolute-positioned overlays outside an inner scroll container's subtree", () => {
    // On Confluence, floating toolbars/chat bubbles are NOT position:fixed — they're absolutely
    // positioned siblings of the scroll container, so they sit still while the container
    // scrolls. They repeated in every frame because the fixed/sticky check missed them.
    const container = document.createElement("div");
    mockRect(container, { x: 0, y: 50, width: 1000, height: 750 });
    document.body.appendChild(container);

    const floatingToolbar = document.createElement("div");
    floatingToolbar.style.position = "absolute";
    mockRect(floatingToolbar, { x: 940, y: 300, width: 48, height: 180 });
    document.body.appendChild(floatingToolbar);

    const manager = new StickyElementManager();
    const innerRect = { x: 0, y: 50, width: 1000, height: 750 };
    expect(manager.freeze(innerRect, container)).toBe(1);
    manager.applyForFrame(false, false);
    expect(floatingToolbar.style.visibility).toBe("hidden");

    manager.restore();
    expect(floatingToolbar.style.visibility).toBe("");
  });

  it("never tracks ancestors of the scroll container (hiding them would blank the capture)", () => {
    const wrapper = document.createElement("div");
    mockRect(wrapper, { x: 0, y: 0, width: 1000, height: 100 }); // short border box, tall subtree
    const container = document.createElement("div");
    mockRect(container, { x: 0, y: 50, width: 1000, height: 750 });
    wrapper.appendChild(container);
    document.body.appendChild(wrapper);

    const manager = new StickyElementManager();
    expect(manager.freeze({ x: 0, y: 50, width: 1000, height: 750 }, container)).toBe(0);
  });

  it("ignores outside-subtree elements that don't overlap the capture region", () => {
    const container = document.createElement("div");
    mockRect(container, { x: 200, y: 50, width: 800, height: 750 });
    document.body.appendChild(container);

    const leftNav = document.createElement("div");
    leftNav.style.position = "absolute";
    mockRect(leftNav, { x: 0, y: 100, width: 180, height: 200 }); // entirely left of the container
    document.body.appendChild(leftNav);

    const manager = new StickyElementManager();
    expect(manager.freeze({ x: 200, y: 50, width: 800, height: 750 }, container)).toBe(0);
  });

  it("document-scroll mode (no inner container): absolute overlays are NOT tracked, only fixed/sticky", () => {
    const absoluteBanner = document.createElement("div");
    absoluteBanner.style.position = "absolute";
    mockRect(absoluteBanner, { x: 0, y: 0, width: 1000, height: 60 });
    document.body.appendChild(absoluteBanner);

    const manager = new StickyElementManager();
    expect(manager.freeze(captureRect, null)).toBe(0); // absolute elements scroll with the page
  });

  it("movement-based: hides a JS-pinned element that stays put while everything else scrolls", () => {
    // Some widgets are pinned by JavaScript (absolute position updated on every scroll event,
    // or transforms) — no CSS inspection can identify them. Behavior can: after a real scroll,
    // content moves on screen and pinned UI doesn't.
    const content = document.createElement("p");
    mockRect(content, { x: 100, y: 400, width: 600, height: 40 });
    document.body.appendChild(content);

    const jsPinnedToolbar = document.createElement("div");
    jsPinnedToolbar.style.position = "absolute";
    mockRect(jsPinnedToolbar, { x: 940, y: 300, width: 48, height: 180 });
    document.body.appendChild(jsPinnedToolbar);

    const manager = new StickyElementManager();
    expect(manager.freeze(captureRect, null)).toBe(0); // nothing CSS-pinned

    manager.applyForFrame(true, false, 0); // frame 1: records the position snapshot
    expect(jsPinnedToolbar.style.visibility).toBe("");

    // Simulate the scroll: content moved up 300px on screen, the pinned toolbar did not.
    mockRect(content, { x: 100, y: 100, width: 600, height: 40 });

    manager.applyForFrame(false, false, 700); // frame 2: detection kicks in
    expect(jsPinnedToolbar.style.visibility).toBe("hidden");
    expect(content.style.visibility).toBe(""); // moving content is never touched

    manager.applyForFrame(false, true); // last frame: stays hidden (always-hide, no re-show)
    expect(jsPinnedToolbar.style.visibility).toBe("hidden");

    manager.restore();
    expect(jsPinnedToolbar.style.visibility).toBe("");
  });

  it("probe observation detects JS-pinned elements before frame 1 and classifies them positionally", () => {
    // Pre-capture probe scrolls let movement detection identify pinned elements BEFORE any
    // frame is captured. They must be classified top/bottom (one legitimate appearance) — not
    // always-hidden, which would erase a pinned-in-place original header from the capture.
    const content = document.createElement("p");
    mockRect(content, { x: 100, y: 500, width: 600, height: 40 });
    document.body.appendChild(content);

    const pinnedHeader = document.createElement("div");
    pinnedHeader.style.position = "absolute";
    mockRect(pinnedHeader, { x: 0, y: 60, width: 1000, height: 50 }); // top half → "top"
    document.body.appendChild(pinnedHeader);

    const manager = new StickyElementManager();
    expect(manager.freeze(captureRect, null)).toBe(0);

    manager.observe(480); // first probe: snapshot only
    expect(pinnedHeader.style.visibility).toBe(""); // observe never hides

    mockRect(content, { x: 100, y: 20, width: 600, height: 40 }); // content moved; header didn't
    manager.observe(960); // second probe: detection
    expect(pinnedHeader.style.visibility).toBe(""); // still not hidden — observation only

    manager.applyForFrame(true, false, 0); // frame 1: "top" classification → shown
    expect(pinnedHeader.style.visibility).toBe("");

    manager.applyForFrame(false, false, 700); // middle frame → hidden
    expect(pinnedHeader.style.visibility).toBe("hidden");
  });

  it("movement-based: does not trigger when the scroll delta is below the threshold", () => {
    const widget = document.createElement("div");
    widget.style.position = "absolute";
    mockRect(widget, { x: 940, y: 300, width: 48, height: 180 });
    document.body.appendChild(widget);

    const manager = new StickyElementManager();
    manager.freeze(captureRect, null);
    manager.applyForFrame(true, false, 0);
    manager.applyForFrame(false, false, 20); // 20px < 40px threshold — could be scroll clamping
    expect(widget.style.visibility).toBe("");
  });

  it("regression: tracks and hides fixed elements mounted AFTER freeze() (dynamic floating UI)", () => {
    // The bug seen on Confluence: floating table-header clones and toolbars are created while
    // scrolling — after the initial scan — so they were never hidden and repeated at every
    // frame boundary. applyForFrame must rescan and catch them.
    const manager = new StickyElementManager();
    expect(manager.freeze(captureRect, null)).toBe(0); // nothing sticky exists yet

    const lateToolbar = makeStickyEl("fixed", { x: 900, y: 300, width: 60, height: 200 });
    lateToolbar.style.setProperty("color", "blue");
    const originalCssText = lateToolbar.style.cssText;

    manager.applyForFrame(false, false); // middle frame — must pick it up and hide it
    expect(lateToolbar.style.visibility).toBe("hidden");

    manager.restore();
    expect(lateToolbar.style.cssText).toBe(originalCssText);
    expect(lateToolbar.hasAttribute("data-fps-frozen")).toBe(false);
  });

  it("regression: rescanning never re-tracks an element it already hid (originalCssText stays pristine)", () => {
    const header = makeStickyEl("fixed", { x: 0, y: 0, width: 1000, height: 60 });
    header.style.setProperty("color", "red");
    const originalCssText = header.style.cssText;

    const manager = new StickyElementManager();
    manager.freeze(captureRect, null);
    manager.applyForFrame(false, false); // hides it
    manager.applyForFrame(false, false); // rescans — must NOT re-capture the hidden state
    manager.applyForFrame(false, false);

    manager.restore();
    expect(header.style.cssText).toBe(originalCssText); // not "visibility: hidden !important"
  });

  it("finds fixed elements inside open shadow roots", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });

    const bubble = document.createElement("div");
    bubble.style.position = "fixed";
    mockRect(bubble, { x: 940, y: 700, width: 48, height: 48 });
    shadow.appendChild(bubble);

    const manager = new StickyElementManager();
    expect(manager.freeze(captureRect, null)).toBe(1);
    manager.applyForFrame(false, false);
    expect(bubble.style.visibility).toBe("hidden");

    manager.restore();
    expect(bubble.style.visibility).toBe("");
  });

  it("restore() reverts every mutated element back to its original inline style", () => {
    const header = makeStickyEl("fixed", { x: 0, y: 0, width: 1000, height: 60 });
    header.style.setProperty("color", "red"); // some pre-existing inline style to preserve
    const originalCssText = header.style.cssText;

    const manager = new StickyElementManager();
    manager.freeze(captureRect, null);
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
    manager.freeze(captureRect, null);
    manager.restore();

    manager.applyForFrame(true, false); // must not throw, must not touch the element
    expect(header.style.visibility).toBe("");
  });

  it("a second freeze() call starts fresh rather than accumulating previously tracked elements", () => {
    const first = makeStickyEl("fixed", { x: 0, y: 0, width: 1000, height: 60 });
    const manager = new StickyElementManager();
    expect(manager.freeze(captureRect, null)).toBe(1);

    document.body.removeChild(first);
    const second = makeStickyEl("fixed", { x: 0, y: 0, width: 1000, height: 60 });
    expect(manager.freeze(captureRect, null)).toBe(1);

    manager.applyForFrame(false, false);
    expect(second.style.visibility).toBe("hidden");
  });
});
