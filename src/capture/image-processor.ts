import { MAX_CANVAS_AREA_PX, MAX_CANVAS_DIMENSION_PX } from "@shared/constants";
import type { ImageFormat, Rect } from "@shared/types";
import { blobToDataUrl } from "@shared/utilities";

export interface EncodedImage {
  buffer: ArrayBuffer;
  mimeType: string;
  width: number;
  height: number;
}

function mimeTypeFor(format: ImageFormat): string {
  return format === "jpeg" ? "image/jpeg" : "image/png";
}

/** Chrome/most browsers cap a single 2D canvas's dimensions and total pixel area. */
export function assertCanvasSizeIsSupported(width: number, height: number): void {
  if (width <= 0 || height <= 0) {
    throw new Error("Computed canvas size is empty — nothing to render.");
  }
  if (width > MAX_CANVAS_DIMENSION_PX || height > MAX_CANVAS_DIMENSION_PX) {
    throw new Error(
      `This page is too large to capture (${width}×${height}px exceeds the ${MAX_CANVAS_DIMENSION_PX}px browser canvas limit). Try capturing in sections instead.`
    );
  }
  if (width * height > MAX_CANVAS_AREA_PX) {
    throw new Error(
      "This page is too large to capture as a single image — the total pixel area exceeds what the browser's canvas can hold."
    );
  }
}

export async function decodeImage(buffer: ArrayBuffer, mimeType: string): Promise<ImageBitmap> {
  const blob = new Blob([buffer], { type: mimeType });
  return createImageBitmap(blob);
}

export async function canvasToEncodedImage(
  canvas: OffscreenCanvas,
  format: ImageFormat,
  quality: number
): Promise<EncodedImage> {
  const mimeType = mimeTypeFor(format);
  const blob = await canvas.convertToBlob(
    format === "jpeg" ? { type: mimeType, quality: quality / 100 } : { type: mimeType }
  );
  const buffer = await blob.arrayBuffer();
  return { buffer, mimeType, width: canvas.width, height: canvas.height };
}

export async function getImageDimensions(
  buffer: ArrayBuffer,
  mimeType: string
): Promise<{ width: number; height: number }> {
  const bitmap = await decodeImage(buffer, mimeType);
  const dims = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return dims;
}

/** Crops a single captured frame to a CSS-pixel rectangle, scaling by devicePixelRatio. */
export async function cropImage(
  buffer: ArrayBuffer,
  mimeType: string,
  rect: Rect,
  devicePixelRatio: number,
  format: ImageFormat,
  quality: number
): Promise<EncodedImage> {
  const bitmap = await decodeImage(buffer, mimeType);
  try {
    const sx = Math.round(rect.x * devicePixelRatio);
    const sy = Math.round(rect.y * devicePixelRatio);
    const sw = Math.round(rect.width * devicePixelRatio);
    const sh = Math.round(rect.height * devicePixelRatio);
    assertCanvasSizeIsSupported(sw, sh);

    const canvas = new OffscreenCanvas(sw, sh);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Unable to acquire a 2D canvas context for cropping.");
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
    return canvasToEncodedImage(canvas, format, quality);
  } finally {
    bitmap.close();
  }
}

/** Produces a small JPEG data URL thumbnail for the history list, capped at `maxWidth`. */
export async function createThumbnailDataUrl(blob: Blob, maxWidth: number): Promise<string> {
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, maxWidth / bitmap.width);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Unable to acquire a 2D canvas context for the thumbnail.");
    ctx.drawImage(bitmap, 0, 0, width, height);
    const thumbBlob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.7 });
    return await blobToDataUrl(thumbBlob);
  } finally {
    bitmap.close();
  }
}

/** Re-encodes an image as PNG — the Async Clipboard API only reliably accepts image/png. */
export async function ensurePngForClipboard(
  buffer: ArrayBuffer,
  mimeType: string
): Promise<EncodedImage> {
  if (mimeType === "image/png") {
    const dims = await getImageDimensions(buffer, mimeType);
    return { buffer, mimeType, ...dims };
  }
  const bitmap = await decodeImage(buffer, mimeType);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Unable to acquire a 2D canvas context for PNG conversion.");
    ctx.drawImage(bitmap, 0, 0);
    return canvasToEncodedImage(canvas, "png", 100);
  } finally {
    bitmap.close();
  }
}

/**
 * Writes an image blob to the system clipboard. Must be called directly from a visible,
 * focused extension page (popup/preview) in response to a user gesture — the Async Clipboard
 * API requires document focus, which a hidden offscreen document can never have.
 */
export async function copyBlobToClipboard(blob: Blob): Promise<void> {
  if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
    throw new Error("Clipboard access is not available in this browser.");
  }
  let pngBlob = blob;
  if (blob.type !== "image/png") {
    const buffer = await blob.arrayBuffer();
    const encoded = await ensurePngForClipboard(buffer, blob.type);
    pngBlob = new Blob([encoded.buffer], { type: encoded.mimeType });
  }
  await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
}
