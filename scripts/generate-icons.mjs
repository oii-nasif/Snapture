// Generates the toolbar/store icons procedurally (rounded square + viewfinder brackets +
// shutter dot) so the project ships real PNGs without depending on an image library.
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng } from "./png-encoder.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(rootDir, "src", "icons");

const SIZES = [16, 32, 48, 128];
const BG_FROM = [79, 70, 229]; // indigo-600
const BG_TO = [124, 58, 237]; // violet-600
const WHITE = [255, 255, 255];

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function mixColor(t) {
  return [
    lerp(BG_FROM[0], BG_TO[0], t),
    lerp(BG_FROM[1], BG_TO[1], t),
    lerp(BG_FROM[2], BG_TO[2], t),
  ];
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

/** Signed distance to a rounded rect centered at (0,0) with half-extents (hw, hh) and corner radius r. */
function roundedRectSd(x, y, hw, hh, r) {
  const qx = Math.abs(x) - (hw - r);
  const qy = Math.abs(y) - (hh - r);
  const outsideX = Math.max(qx, 0);
  const outsideY = Math.max(qy, 0);
  return Math.sqrt(outsideX * outsideX + outsideY * outsideY) + Math.min(Math.max(qx, qy), 0) - r;
}

function drawIcon(size) {
  const rgba = new Uint8ClampedArray(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const half = size / 2;
  const cornerRadius = size * 0.22;

  const bracketInset = size * 0.2;
  const bracketLen = size * 0.24;
  const bracketThickness = Math.max(1, size * 0.09);
  const dotRadius = size * 0.1;
  const aa = Math.max(0.6, size * 0.01); // anti-alias width in px

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5 - cx;
      const py = y + 0.5 - cy;

      const bgDist = roundedRectSd(px, py, half, half, cornerRadius);
      const bgCoverage = clamp01(0.5 - bgDist / aa);

      const t = clamp01((py + half) / size);
      const [r, g, b] = mixColor(t);

      let outR = 0;
      let outG = 0;
      let outB = 0;
      let outA = 0;

      if (bgCoverage > 0) {
        outR = r;
        outG = g;
        outB = b;
        outA = bgCoverage * 255;
      }

      // Viewfinder corner brackets (L shapes), drawn in white with anti-aliased coverage.
      const corners = [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ];
      for (const [sx, sy] of corners) {
        const originX = sx * (half - bracketInset);
        const originY = sy * (half - bracketInset);
        // Horizontal arm
        const hArmDist = roundedRectSd(
          px - originX + (sx * bracketLen) / 2,
          py - originY,
          bracketLen / 2,
          bracketThickness / 2,
          bracketThickness / 3
        );
        // Vertical arm
        const vArmDist = roundedRectSd(
          px - originX,
          py - originY + (sy * bracketLen) / 2,
          bracketThickness / 2,
          bracketLen / 2,
          bracketThickness / 3
        );
        const armCoverage = Math.max(
          clamp01(0.5 - hArmDist / aa),
          clamp01(0.5 - vArmDist / aa)
        );
        if (armCoverage > 0) {
          outR = lerp(outR, WHITE[0], armCoverage);
          outG = lerp(outG, WHITE[1], armCoverage);
          outB = lerp(outB, WHITE[2], armCoverage);
          outA = Math.max(outA, armCoverage * 255);
        }
      }

      // Center shutter dot.
      const dotDist = Math.sqrt(px * px + py * py) - dotRadius;
      const dotCoverage = clamp01(0.5 - dotDist / aa);
      if (dotCoverage > 0) {
        outR = lerp(outR, WHITE[0], dotCoverage);
        outG = lerp(outG, WHITE[1], dotCoverage);
        outB = lerp(outB, WHITE[2], dotCoverage);
        outA = Math.max(outA, dotCoverage * 255);
      }

      const i = (y * size + x) * 4;
      rgba[i] = outR;
      rgba[i + 1] = outG;
      rgba[i + 2] = outB;
      rgba[i + 3] = outA;
    }
  }

  return rgba;
}

async function run() {
  await fs.mkdir(outDir, { recursive: true });
  for (const size of SIZES) {
    const rgba = drawIcon(size);
    const png = encodePng(size, size, rgba);
    const filePath = path.join(outDir, `icon-${size}.png`);
    await fs.writeFile(filePath, png);
    console.log(`Wrote ${path.relative(rootDir, filePath)}`);
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
