import { clamp } from "@shared/utilities";

export interface ScrollStep {
  y: number;
  isFirst: boolean;
  isLast: boolean;
}

/**
 * Computes the sequence of scroll-Y targets needed to cover a document from top to bottom.
 * Consecutive steps overlap by `overlapPx` (clamped so it can never stall progress) so that
 * seams in the stitched image always have shared content to align against, and the final
 * step is pinned to `documentHeight - viewportHeight` so the last frame ends flush with the
 * bottom of the page instead of overshooting past it.
 */
export function computeScrollSteps(
  documentHeight: number,
  viewportHeight: number,
  overlapPx: number
): ScrollStep[] {
  if (viewportHeight <= 0 || documentHeight <= viewportHeight) {
    return [{ y: 0, isFirst: true, isLast: true }];
  }

  const overlap = clamp(overlapPx, 0, Math.floor(viewportHeight / 2));
  const step = Math.max(1, viewportHeight - overlap);
  const maxY = documentHeight - viewportHeight;

  const ys: number[] = [];
  let y = 0;
  while (y < maxY) {
    ys.push(y);
    y += step;
  }
  ys.push(maxY);

  const deduped = ys.filter((value, index) => index === 0 || value !== ys[index - 1]);

  return deduped.map((value, index) => ({
    y: value,
    isFirst: index === 0,
    isLast: index === deduped.length - 1,
  }));
}

/**
 * Given a page that grew while we were scrolling (lazy-loaded content appended below the fold),
 * recomputes the remaining steps from the current position without re-visiting ground already
 * covered, capped at `maxHeight` so infinite-scroll pages can't grow the plan forever.
 */
export function extendScrollPlanForGrowth(
  currentY: number,
  newDocumentHeight: number,
  viewportHeight: number,
  overlapPx: number,
  maxHeight: number
): ScrollStep[] {
  const cappedHeight = Math.min(newDocumentHeight, maxHeight);
  if (cappedHeight <= currentY + viewportHeight) {
    return [{ y: currentY, isFirst: false, isLast: true }];
  }
  const remainingHeight = cappedHeight - currentY;
  const steps = computeScrollSteps(remainingHeight, viewportHeight, overlapPx);
  return steps.map((step, index) => ({
    y: step.y + currentY,
    isFirst: false,
    isLast: index === steps.length - 1,
  }));
}
