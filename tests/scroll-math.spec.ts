import { describe, expect, it } from "vitest";
import { computeScrollSteps, extendScrollPlanForGrowth } from "../src/content/scroll-math";

describe("computeScrollSteps", () => {
  it("returns a single step when the document fits in one viewport", () => {
    const steps = computeScrollSteps(800, 900, 20);
    expect(steps).toEqual([{ y: 0, isFirst: true, isLast: true }]);
  });

  it("returns a single step when document height exactly equals viewport height", () => {
    const steps = computeScrollSteps(900, 900, 20);
    expect(steps).toEqual([{ y: 0, isFirst: true, isLast: true }]);
  });

  it("covers a long page with overlapping steps and pins the last step to the bottom", () => {
    const steps = computeScrollSteps(2000, 800, 100);
    // step size = 800 - 100 = 700; maxY = 2000 - 800 = 1200
    expect(steps.map((s) => s.y)).toEqual([0, 700, 1200]);
    expect(steps[0]?.isFirst).toBe(true);
    expect(steps[steps.length - 1]?.isLast).toBe(true);
    expect(steps.filter((s) => s.isLast)).toHaveLength(1);
  });

  it("never misses content: consecutive steps always overlap or touch", () => {
    const steps = computeScrollSteps(5000, 1000, 50);
    for (let i = 1; i < steps.length; i++) {
      const prev = steps[i - 1]!;
      const curr = steps[i]!;
      // The next step must start at or before where the previous viewport ended.
      expect(curr.y).toBeLessThanOrEqual(prev.y + 1000);
    }
    expect(steps[steps.length - 1]!.y).toBe(4000);
  });

  it("clamps an overlap that is larger than the viewport instead of looping forever", () => {
    const steps = computeScrollSteps(10000, 500, 100000);
    expect(steps.length).toBeGreaterThan(1);
    expect(steps.every((s) => Number.isFinite(s.y))).toBe(true);
    expect(steps[steps.length - 1]!.y).toBe(9500);
  });

  it("handles a document only 1px taller than the viewport", () => {
    const steps = computeScrollSteps(901, 900, 20);
    expect(steps.map((s) => s.y)).toEqual([0, 1]);
  });

  it("de-duplicates when the step size lands exactly on the final position", () => {
    const steps = computeScrollSteps(1600, 800, 0);
    expect(steps.map((s) => s.y)).toEqual([0, 800]);
  });
});

describe("extendScrollPlanForGrowth", () => {
  it("adds no further steps when growth is within the current viewport", () => {
    const steps = extendScrollPlanForGrowth(1000, 1500, 800, 50, 30000);
    expect(steps).toEqual([{ y: 1000, isFirst: false, isLast: true }]);
  });

  it("extends the plan to cover newly appended content", () => {
    const steps = extendScrollPlanForGrowth(1000, 4000, 800, 100, 30000);
    expect(steps[steps.length - 1]!.isLast).toBe(true);
    expect(steps[steps.length - 1]!.y).toBe(4000 - 800);
    expect(steps.every((s) => s.y >= 1000)).toBe(true);
  });

  it("caps growth at maxHeight to guard against infinite-scroll pages", () => {
    const steps = extendScrollPlanForGrowth(1000, 500000, 800, 100, 20000);
    expect(steps[steps.length - 1]!.y).toBe(20000 - 800);
  });
});
