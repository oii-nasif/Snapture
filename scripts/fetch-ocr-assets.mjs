// Downloads the Tesseract English language data used by the on-device OCR feature.
// The file is cached under vendor/ocr/ (gitignored) and copied into dist/ by the build,
// so the packed extension ships it locally — no runtime network requests.
import { promises as fs } from "node:fs";
import path from "node:path";

const LANG_FILE = "eng.traineddata.gz";
const MIN_BYTES = 1_000_000;

// tessdata_fast: ~4x smaller and faster than the standard models, at a small
// accuracy cost — the right trade-off for screenshot text.
const SOURCES = [
  `https://tessdata.projectnaptha.com/4.0.0_fast/${LANG_FILE}`,
  `https://raw.githubusercontent.com/naptha/tessdata/gh-pages/4.0.0_fast/${LANG_FILE}`,
];

export async function ensureOcrLanguageData(rootDir) {
  const target = path.join(rootDir, "vendor", "ocr", LANG_FILE);

  try {
    const stat = await fs.stat(target);
    if (stat.size >= MIN_BYTES) return target;
  } catch {
    // Not cached yet.
  }

  await fs.mkdir(path.dirname(target), { recursive: true });

  let lastError;
  for (const url of SOURCES) {
    try {
      const response = await fetch(url, { redirect: "follow" });
      if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length < MIN_BYTES) {
        throw new Error(`Suspiciously small download (${buffer.length} bytes) from ${url}`);
      }
      await fs.writeFile(target, buffer);
      console.log(
        `Fetched OCR language data (${(buffer.length / 1024 / 1024).toFixed(1)} MB) → ${path.relative(rootDir, target)}`
      );
      return target;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `Unable to download ${LANG_FILE} for the OCR feature (tried ${SOURCES.length} sources). ` +
      `Last error: ${lastError}. Place the file manually at vendor/ocr/${LANG_FILE} to build offline.`
  );
}

if (process.argv[1] && process.argv[1].endsWith("fetch-ocr-assets.mjs")) {
  const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..");
  ensureOcrLanguageData(rootDir).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
