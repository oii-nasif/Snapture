import { describe, expect, it } from "vitest";
import { computeStitchPlan } from "../src/capture/stitch-math";

describe("computeStitchPlan", () => {
  it("produces a single full-height segment for a one-frame capture", () => {
    const plan = computeStitchPlan([{ actualY: 0 }], 1280, 800, 800, 1);
    expect(plan.segments).toEqual([{ sourceIndex: 0, cropTopPx: 0, heightPx: 800, destYPx: 0 }]);
    expect(plan.canvasWidthPx).toBe(1280);
    expect(plan.canvasHeightPx).toBe(800);
  });

  it("crops overlapping tops so no region is drawn twice", () => {
    const frames = [{ actualY: 0 }, { actualY: 700 }, { actualY: 1200 }];
    const plan = computeStitchPlan(frames, 1280, 800, 2000, 1);
    expect(plan.segments).toHaveLength(3);
    expect(plan.segments[0]).toEqual({ sourceIndex: 0, cropTopPx: 0, heightPx: 800, destYPx: 0 });
    // Frame 2 starts at 700 but frame 1 already covered up to 800 -> crop 100px off the top.
    expect(plan.segments[1]).toEqual({ sourceIndex: 1, cropTopPx: 100, heightPx: 700, destYPx: 800 });
    // Frame 3 starts at 1200, previous covered up to 1500 -> crop 300px off the top.
    expect(plan.segments[2]).toEqual({ sourceIndex: 2, cropTopPx: 300, heightPx: 500, destYPx: 1500 });
    expect(plan.canvasHeightPx).toBe(2000);
  });

  it("drops a frame that contributes no new content (e.g. clamped at the bottom)", () => {
    const frames = [{ actualY: 0 }, { actualY: 1200 }, { actualY: 1200 }];
    const plan = computeStitchPlan(frames, 1280, 800, 2000, 1);
    expect(plan.segments.map((s) => s.sourceIndex)).toEqual([0, 1]);
    expect(plan.canvasHeightPx).toBe(2000);
  });

  it("handles a partial final viewport without overshooting document height", () => {
    const frames = [{ actualY: 0 }, { actualY: 500 }];
    const plan = computeStitchPlan(frames, 1000, 800, 1000, 1);
    expect(plan.segments[1]).toEqual({ sourceIndex: 1, cropTopPx: 300, heightPx: 200, destYPx: 800 });
    expect(plan.canvasHeightPx).toBe(1000);
  });

  it("scales crop and destination coordinates by devicePixelRatio", () => {
    const frames = [{ actualY: 0 }, { actualY: 700 }];
    const plan = computeStitchPlan(frames, 1280, 800, 1500, 2);
    expect(plan.canvasWidthPx).toBe(2560);
    expect(plan.canvasHeightPx).toBe(3000);
    expect(plan.segments[1]).toEqual({ sourceIndex: 1, cropTopPx: 200, heightPx: 1400, destYPx: 1600 });
  });

  it("produces zero-height output for an empty frame list", () => {
    const plan = computeStitchPlan([], 1280, 800, 800, 1);
    expect(plan.segments).toEqual([]);
    expect(plan.canvasHeightPx).toBe(0);
  });
});
