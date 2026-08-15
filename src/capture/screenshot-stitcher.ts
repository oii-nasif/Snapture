import type { ImageFormat } from "@shared/types";
import {
  assertCanvasSizeIsSupported,
  canvasToEncodedImage,
  decodeImage,
  type EncodedImage,
} from "./image-processor";
import { computeStitchPlan, type CapturedFrame } from "./stitch-math";

export interface StitchInputFrame extends CapturedFrame {
  buffer: ArrayBuffer;
  mimeType: string;
}

/**
 * Composites captured viewport frames into one seamless image. `computeStitchPlan` (pure,
 * unit-tested) decides exactly which pixel rows come from which frame; this function's only
 * job is to execute that plan on an OffscreenCanvas, decoding and immediately releasing
 * (`close()`) each source bitmap so peak memory stays proportional to one frame at a time
 * rather than the whole page.
 */
export async function stitchFrames(
  frames: StitchInputFrame[],
  viewportWidthCss: number,
  viewportHeightCss: number,
  documentHeightCss: number,
  devicePixelRatio: number,
  format: ImageFormat,
  quality: number,
  onSegmentDrawn?: (drawn: number, total: number) => void
): Promise<EncodedImage> {
  const plan = computeStitchPlan(
    frames,
    viewportWidthCss,
    viewportHeightCss,
    documentHeightCss,
    devicePixelRatio
  );

  assertCanvasSizeIsSupported(plan.canvasWidthPx, plan.canvasHeightPx);

  const canvas = new OffscreenCanvas(plan.canvasWidthPx, plan.canvasHeightPx);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Unable to acquire a 2D canvas context for stitching.");

  for (let i = 0; i < plan.segments.length; i++) {
    const segment = plan.segments[i];
    if (!segment) continue;
    const frame = frames[segment.sourceIndex];
    if (!frame) continue;

    const bitmap = await decodeImage(frame.buffer, frame.mimeType);
    try {
      ctx.drawImage(
        bitmap,
        0,
        segment.cropTopPx,
        bitmap.width,
        segment.heightPx,
        0,
        segment.destYPx,
        bitmap.width,
        segment.heightPx
      );
    } finally {
      bitmap.close();
    }
    onSegmentDrawn?.(i + 1, plan.segments.length);
  }

  return canvasToEncodedImage(canvas, format, quality);
}
