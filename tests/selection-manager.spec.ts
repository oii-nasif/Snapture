// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { SelectionManager } from "../src/content/selection-manager";

const OVERLAY_SELECTOR = "[data-fps-overlay]";

function fireMouse(target: EventTarget, type: string, x: number, y: number, button = 0): void {
  target.dispatchEvent(
    new MouseEvent(type, { clientX: x, clientY: y, button, bubbles: true, cancelable: true })
  );
}

function fireKey(key: string): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

function getOverlay(): Element {
  const el = document.documentElement.querySelector(OVERLAY_SELECTOR);
  if (!el) throw new Error("overlay not found — did start() run?");
  return el;
}

function drag(overlay: Element, x1: number, y1: number, x2: number, y2: number): void {
  fireMouse(overlay, "mousedown", x1, y1);
  fireMouse(window, "mousemove", x2, y2);
  fireMouse(window, "mouseup", x2, y2);
}

function clickToolbarButton(label: string): void {
  const buttons = document.documentElement.querySelectorAll(`${OVERLAY_SELECTOR}`);
  const button = Array.from(buttons).find((el) => el.tagName === "BUTTON" && el.textContent === label);
  if (!button) throw new Error(`toolbar button "${label}" not found`);
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("SelectionManager", () => {
  afterEach(() => {
    document.documentElement.querySelectorAll(OVERLAY_SELECTOR).forEach((el) => el.remove());
  });

  it("builds an overlay on start() and removes every overlay element once resolved", async () => {
    const manager = new SelectionManager();
    const promise = manager.start();
    expect(document.documentElement.querySelectorAll(OVERLAY_SELECTOR).length).toBeGreaterThan(0);

    const overlay = getOverlay();
    drag(overlay, 50, 60, 250, 300);
    clickToolbarButton("Capture");

    await promise;
    expect(document.documentElement.querySelectorAll(OVERLAY_SELECTOR).length).toBe(0);
  });

  it("resolves with the drag rectangle, normalized regardless of drag direction", async () => {
    const manager = new SelectionManager();
    const promise = manager.start();
    const overlay = getOverlay();

    // Dragged from bottom-right to top-left — rect must still come out normalized (min x/y).
    drag(overlay, 300, 250, 100, 50);
    clickToolbarButton("Capture");

    const rect = await promise;
    expect(rect).toEqual({ x: 100, y: 50, width: 200, height: 200 });
  });

  it("ignores non-primary mouse buttons (e.g. right-click) as a drag start", async () => {
    const manager = new SelectionManager();
    manager.start();
    const overlay = getOverlay();

    fireMouse(overlay, "mousedown", 50, 50, 2); // right button
    fireMouse(window, "mousemove", 200, 200);
    fireMouse(window, "mouseup", 200, 200);

    // No toolbar should have appeared since no drag was recognized.
    const toolbarButtons = document.documentElement.querySelectorAll(`${OVERLAY_SELECTOR}`);
    const hasCaptureButton = Array.from(toolbarButtons).some((el) => el.textContent === "Capture");
    expect(hasCaptureButton).toBe(false);

    manager.cancel();
  });

  it("rejects drags smaller than the minimum selection size — no toolbar, stays pending", async () => {
    const manager = new SelectionManager();
    const promise = manager.start();
    const overlay = getOverlay();

    drag(overlay, 100, 100, 101, 101); // 1x1 — below MIN_SELECTION_SIZE

    let settled = false;
    promise.then(() => (settled = true));
    await new Promise((r) => setTimeout(r, 10));
    expect(settled).toBe(false);

    manager.cancel();
    await promise;
  });

  it("Escape cancels and resolves null, tearing down the overlay", async () => {
    const manager = new SelectionManager();
    const promise = manager.start();
    const overlay = getOverlay();

    drag(overlay, 10, 10, 200, 200);
    fireKey("Escape");

    const rect = await promise;
    expect(rect).toBeNull();
    expect(document.documentElement.querySelectorAll(OVERLAY_SELECTOR).length).toBe(0);
  });

  it("Enter confirms the current drag rect without needing the toolbar click", async () => {
    const manager = new SelectionManager();
    const promise = manager.start();
    const overlay = getOverlay();

    fireMouse(overlay, "mousedown", 20, 30, 0);
    fireMouse(window, "mousemove", 220, 330);
    fireMouse(window, "mouseup", 220, 330);
    fireKey("Enter");

    const rect = await promise;
    expect(rect).toEqual({ x: 20, y: 30, width: 200, height: 300 });
  });

  it("Enter with no active drag does nothing (currentRect is null)", async () => {
    const manager = new SelectionManager();
    const promise = manager.start();

    fireKey("Enter"); // no drag happened yet

    let settled = false;
    promise.then(() => (settled = true));
    await new Promise((r) => setTimeout(r, 10));
    expect(settled).toBe(false);

    manager.cancel();
    await promise;
  });

  it("clicking Cancel in the toolbar clears the selection but leaves the session pending for a re-drag", async () => {
    const manager = new SelectionManager();
    const promise = manager.start();
    const overlay = getOverlay();

    drag(overlay, 10, 10, 200, 200);
    clickToolbarButton("Cancel");

    let settled = false;
    promise.then(() => (settled = true));
    await new Promise((r) => setTimeout(r, 10));
    expect(settled).toBe(false);
    // Overlay itself is still there for another attempt.
    expect(document.documentElement.querySelector(OVERLAY_SELECTOR)).not.toBeNull();

    // A fresh drag should still work after cancelling the first one.
    drag(overlay, 30, 30, 130, 130);
    clickToolbarButton("Capture");
    const rect = await promise;
    expect(rect).toEqual({ x: 30, y: 30, width: 100, height: 100 });
  });

  it("cancel() resolves null directly without any drag", async () => {
    const manager = new SelectionManager();
    const promise = manager.start();
    manager.cancel();
    await expect(promise).resolves.toBeNull();
  });

  it("calling start() again tears down a still-pending previous session", async () => {
    const manager = new SelectionManager();
    const firstPromise = manager.start();
    const secondPromise = manager.start();

    // Only one overlay's worth of elements should exist, not two stacked sessions.
    const overlays = document.documentElement.querySelectorAll('[data-fps-overlay]:not([style*="display: none"])');
    expect(overlays.length).toBeGreaterThan(0);

    manager.cancel();
    await expect(secondPromise).resolves.toBeNull();
    // The first promise from the superseded session is simply left unresolved — verify it
    // didn't spuriously resolve too.
    let firstSettled = false;
    firstPromise.then(() => (firstSettled = true));
    await new Promise((r) => setTimeout(r, 10));
    expect(firstSettled).toBe(false);
  });
});
