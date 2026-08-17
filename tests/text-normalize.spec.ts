import { describe, expect, it } from "vitest";
import { normalizeRecognizedText } from "../src/ocr/text-normalize";

describe("normalizeRecognizedText", () => {
  it("trims whitespace from each line", () => {
    expect(normalizeRecognizedText("  hello \n\tworld  ")).toBe("hello\nworld");
  });

  it("collapses runs of blank lines to a single blank line", () => {
    expect(normalizeRecognizedText("one\n\n\n\ntwo")).toBe("one\n\ntwo");
  });

  it("normalizes CRLF and CR line endings", () => {
    expect(normalizeRecognizedText("a\r\nb\rc")).toBe("a\nb\nc");
  });

  it("strips leading and trailing blank lines entirely", () => {
    expect(normalizeRecognizedText("\n\n  \nbody\n\n")).toBe("body");
  });

  it("returns an empty string for whitespace-only input", () => {
    expect(normalizeRecognizedText(" \n \r\n \n")).toBe("");
  });

  it("keeps single blank lines separating paragraphs", () => {
    expect(normalizeRecognizedText("para one\n\npara two")).toBe("para one\n\npara two");
  });
});
