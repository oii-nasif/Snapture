/**
 * Cleans raw OCR output for clipboard and search use: normalizes line endings,
 * strips per-line edge whitespace, and collapses runs of blank lines that tesseract
 * emits between text regions of a stitched screenshot.
 */
export function normalizeRecognizedText(raw: string): string {
  const lines = raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim());

  const collapsed: string[] = [];
  let blankRun = 0;
  for (const line of lines) {
    if (line === "") {
      blankRun += 1;
      if (blankRun > 1) continue;
    } else {
      blankRun = 0;
    }
    collapsed.push(line);
  }

  return collapsed.join("\n").trim();
}
