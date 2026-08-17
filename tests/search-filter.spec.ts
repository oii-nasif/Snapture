import { describe, expect, it } from "vitest";
import { entryMatches, filterEntries, tokenizeQuery } from "../src/history/search-filter";

const entryA = { id: "a", pageTitle: "GitHub - Snapture repo", pageUrl: "https://github.com/oii-nasif/Snapture" };
const entryB = { id: "b", pageTitle: "Example Domain", pageUrl: "https://example.com" };
const entryC = { id: "c", pageTitle: "", pageUrl: "https://internal.tool/dashboard" };

const texts = new Map<string, string>([
  ["a", "Full-page screenshot extension for Chrome & Arc"],
  ["c", "Quarterly revenue: $1.2M\nError budget remaining: 42%"],
]);

describe("tokenizeQuery", () => {
  it("lowercases and splits on whitespace", () => {
    expect(tokenizeQuery("  Hello   WORLD ")).toEqual(["hello", "world"]);
  });

  it("returns no tokens for blank input", () => {
    expect(tokenizeQuery("   ")).toEqual([]);
  });
});

describe("entryMatches", () => {
  it("matches everything when there are no tokens", () => {
    expect(entryMatches(entryB, undefined, [])).toBe(true);
  });

  it("matches against the page title case-insensitively", () => {
    expect(entryMatches(entryA, undefined, ["snapture"])).toBe(true);
  });

  it("matches against the URL", () => {
    expect(entryMatches(entryB, undefined, ["example.com"])).toBe(true);
  });

  it("matches against recognized screenshot text", () => {
    expect(entryMatches(entryC, texts.get("c"), ["revenue"])).toBe(true);
  });

  it("requires every token to match (AND semantics)", () => {
    expect(entryMatches(entryA, texts.get("a"), ["chrome", "arc"])).toBe(true);
    expect(entryMatches(entryA, texts.get("a"), ["chrome", "firefox"])).toBe(false);
  });

  it("does not match tokens absent from title, URL, and text", () => {
    expect(entryMatches(entryB, undefined, ["revenue"])).toBe(false);
  });
});

describe("filterEntries", () => {
  it("returns all entries for an empty query", () => {
    expect(filterEntries([entryA, entryB, entryC], texts, "")).toHaveLength(3);
  });

  it("filters by recognized text across entries", () => {
    expect(filterEntries([entryA, entryB, entryC], texts, "error budget")).toEqual([entryC]);
  });

  it("filters by title and URL for entries without recognized text", () => {
    expect(filterEntries([entryA, entryB, entryC], texts, "example")).toEqual([entryB]);
  });

  it("returns nothing when no entry matches", () => {
    expect(filterEntries([entryA, entryB, entryC], texts, "nonexistent-token")).toEqual([]);
  });
});
