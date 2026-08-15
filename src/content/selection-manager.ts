import type { Rect } from "@shared/types";

const OVERLAY_ATTR = "data-fps-overlay";
const MIN_SELECTION_SIZE = 4;

/**
 * Shows a transparent full-viewport overlay and lets the user drag out a rectangle to capture.
 * Only mouse events on the overlay are intercepted — wheel/keyboard scrolling still reaches the
 * page underneath, so the user can scroll to the right area before or between drags.
 */
export class SelectionManager {
  private overlay: HTMLDivElement | null = null;
  private selectionBox: HTMLDivElement | null = null;
  private dimensionLabel: HTMLDivElement | null = null;
  private toolbar: HTMLDivElement | null = null;
  private resolvePromise: ((rect: Rect | null) => void) | null = null;
  private dragStart: { x: number; y: number } | null = null;
  private currentRect: Rect | null = null;

  private readonly onMouseDown = (event: MouseEvent) => this.handleMouseDown(event);
  private readonly onMouseMove = (event: MouseEvent) => this.handleMouseMove(event);
  private readonly onMouseUp = (event: MouseEvent) => this.handleMouseUp(event);
  private readonly onKeyDown = (event: KeyboardEvent) => this.handleKeyDown(event);

  start(): Promise<Rect | null> {
    this.teardown();
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      this.buildOverlay();
    });
  }

  cancel(): void {
    this.finish(null);
  }

  private buildOverlay(): void {
    const overlay = document.createElement("div");
    overlay.setAttribute(OVERLAY_ATTR, "true");
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      cursor: "crosshair",
      background: "rgba(15, 23, 42, 0.35)",
      userSelect: "none",
    });

    const hint = document.createElement("div");
    hint.setAttribute(OVERLAY_ATTR, "true");
    hint.textContent = "Drag to select an area — Esc to cancel";
    Object.assign(hint.style, {
      position: "fixed",
      top: "16px",
      left: "50%",
      transform: "translateX(-50%)",
      padding: "8px 16px",
      borderRadius: "999px",
      background: "rgba(15, 23, 42, 0.85)",
      color: "#fff",
      font: "500 13px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      pointerEvents: "none",
    });

    const selectionBox = document.createElement("div");
    selectionBox.setAttribute(OVERLAY_ATTR, "true");
    Object.assign(selectionBox.style, {
      position: "fixed",
      border: "2px solid #6366f1",
      background: "rgba(99, 102, 241, 0.15)",
      display: "none",
      pointerEvents: "none",
      boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.35)",
    });

    const dimensionLabel = document.createElement("div");
    dimensionLabel.setAttribute(OVERLAY_ATTR, "true");
    Object.assign(dimensionLabel.style, {
      position: "fixed",
      padding: "2px 8px",
      borderRadius: "6px",
      background: "#6366f1",
      color: "#fff",
      font: "600 12px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      display: "none",
      pointerEvents: "none",
    });

    document.documentElement.appendChild(overlay);
    document.documentElement.appendChild(hint);
    document.documentElement.appendChild(selectionBox);
    document.documentElement.appendChild(dimensionLabel);

    this.overlay = overlay;
    this.selectionBox = selectionBox;
    this.dimensionLabel = dimensionLabel;

    overlay.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("keydown", this.onKeyDown, true);
  }

  private handleMouseDown(event: MouseEvent): void {
    if (event.button !== 0) return;
    this.dragStart = { x: event.clientX, y: event.clientY };
    this.currentRect = null;
    this.removeToolbar();
  }

  private handleMouseMove(event: MouseEvent): void {
    if (!this.dragStart || !this.selectionBox || !this.dimensionLabel) return;

    const rect = this.rectFromPoints(this.dragStart.x, this.dragStart.y, event.clientX, event.clientY);
    this.currentRect = rect;

    Object.assign(this.selectionBox.style, {
      display: "block",
      left: `${rect.x}px`,
      top: `${rect.y}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });

    Object.assign(this.dimensionLabel.style, {
      display: "block",
      left: `${rect.x}px`,
      top: `${Math.max(0, rect.y - 26)}px`,
    });
    this.dimensionLabel.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
  }

  private handleMouseUp(_event: MouseEvent): void {
    if (!this.dragStart || !this.currentRect) {
      this.dragStart = null;
      return;
    }
    this.dragStart = null;

    if (this.currentRect.width < MIN_SELECTION_SIZE || this.currentRect.height < MIN_SELECTION_SIZE) {
      this.currentRect = null;
      if (this.selectionBox) this.selectionBox.style.display = "none";
      if (this.dimensionLabel) this.dimensionLabel.style.display = "none";
      return;
    }

    this.showToolbar(this.currentRect);
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      this.finish(null);
    } else if (event.key === "Enter" && this.currentRect) {
      event.preventDefault();
      this.finish(this.currentRect);
    }
  }

  private showToolbar(rect: Rect): void {
    this.removeToolbar();
    const toolbar = document.createElement("div");
    toolbar.setAttribute(OVERLAY_ATTR, "true");
    Object.assign(toolbar.style, {
      position: "fixed",
      left: `${rect.x}px`,
      top: `${rect.y + rect.height + 8}px`,
      display: "flex",
      gap: "8px",
      zIndex: "2147483647",
    });

    const captureBtn = this.createToolbarButton("Capture", "#6366f1", "#fff", () =>
      this.finish(this.currentRect)
    );
    const cancelBtn = this.createToolbarButton("Cancel", "#e2e8f0", "#0f172a", () => {
      this.currentRect = null;
      if (this.selectionBox) this.selectionBox.style.display = "none";
      if (this.dimensionLabel) this.dimensionLabel.style.display = "none";
      this.removeToolbar();
    });

    toolbar.appendChild(captureBtn);
    toolbar.appendChild(cancelBtn);
    document.documentElement.appendChild(toolbar);
    this.toolbar = toolbar;
  }

  private createToolbarButton(
    label: string,
    background: string,
    color: string,
    onClick: () => void
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.setAttribute(OVERLAY_ATTR, "true");
    button.type = "button";
    button.textContent = label;
    Object.assign(button.style, {
      padding: "6px 14px",
      borderRadius: "8px",
      border: "none",
      background,
      color,
      font: "600 13px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      cursor: "pointer",
      boxShadow: "0 2px 8px rgba(15, 23, 42, 0.25)",
    });
    button.addEventListener("mousedown", (e) => e.stopPropagation());
    button.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
    return button;
  }

  private removeToolbar(): void {
    this.toolbar?.remove();
    this.toolbar = null;
  }

  private rectFromPoints(x1: number, y1: number, x2: number, y2: number): Rect {
    return {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
    };
  }

  private finish(rect: Rect | null): void {
    const resolve = this.resolvePromise;
    this.teardown();
    resolve?.(rect);
  }

  private teardown(): void {
    this.overlay?.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("keydown", this.onKeyDown, true);

    document.querySelectorAll(`[${OVERLAY_ATTR}]`).forEach((el) => el.remove());

    this.overlay = null;
    this.selectionBox = null;
    this.dimensionLabel = null;
    this.toolbar = null;
    this.dragStart = null;
    this.currentRect = null;
    this.resolvePromise = null;
  }
}
