export interface CapturedFrame {
  /** Absolute document Y (CSS px) that this frame's viewport top was scrolled to. */
  actualY: number;
}

export interface StitchPlanSegment {
  /** Index into the input frames array this segment's pixel data comes from. */
  sourceIndex: number;
  /** Vertical offset (device px) to crop off the top of the source frame before drawing. */
  cropTopPx: number;
  /** Height (device px) of the region drawn from this frame. */
  heightPx: number;
  /** Y offset (device px) on the destination canvas to draw this segment at. */
  destYPx: number;
}

export interface StitchPlan {
  segments: StitchPlanSegment[];
  canvasWidthPx: number;
  canvasHeightPx: number;
}

/**
 * Turns a list of captured viewport frames into a draw plan for a single stitched canvas.
 *
 * Frames are placed sequentially top to bottom; whenever a frame's scroll position overlaps
 * ground already covered by the previous frame (deliberate overlap for alignment, or the
 * browser clamping scroll near the bottom), the redundant top portion is cropped off so no
 * region of the page is drawn twice and no seam is visible. A frame that contributes nothing
 * new (e.g. the browser couldn't scroll further) is dropped entirely.
 */
export function computeStitchPlan(
  frames: CapturedFrame[],
  viewportWidthCss: number,
  viewportHeightCss: number,
  documentHeightCss: number,
  devicePixelRatio: number
): StitchPlan {
  const segments: StitchPlanSegment[] = [];
  let prevBottomCss = 0;

  frames.forEach((frame, sourceIndex) => {
    const y = frame.actualY;
    const cropTopCss = Math.max(0, prevBottomCss - y);
    const availableHeightCss = viewportHeightCss - cropTopCss;
    const remainingDocCss = documentHeightCss - (y + cropTopCss);
    const heightCss = Math.max(0, Math.min(availableHeightCss, remainingDocCss));

    if (heightCss <= 0) {
      return;
    }

    const destYCss = y + cropTopCss;
    segments.push({
      sourceIndex,
      cropTopPx: Math.round(cropTopCss * devicePixelRatio),
      heightPx: Math.round(heightCss * devicePixelRatio),
      destYPx: Math.round(destYCss * devicePixelRatio),
    });
    prevBottomCss = destYCss + heightCss;
  });

  return {
    segments,
    canvasWidthPx: Math.round(viewportWidthCss * devicePixelRatio),
    canvasHeightPx: Math.round(prevBottomCss * devicePixelRatio),
  };
}
