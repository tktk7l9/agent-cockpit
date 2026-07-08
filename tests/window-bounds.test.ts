import { describe, expect, it } from "vitest";
import { boundsVisible } from "../src/lib/window-bounds";

describe("boundsVisible", () => {
  const display = { x: 0, y: 0, width: 1920, height: 1080 };

  it("is visible when fully contained in a display", () => {
    expect(boundsVisible({ x: 100, y: 100, width: 800, height: 600 }, [display])).toBe(true);
  });

  it("is visible when partially overlapping a display", () => {
    expect(boundsVisible({ x: 1900, y: 1060, width: 800, height: 600 }, [display])).toBe(true);
  });

  it("is not visible when fully outside every display", () => {
    expect(boundsVisible({ x: 5000, y: 5000, width: 800, height: 600 }, [display])).toBe(false);
  });

  it("is not visible when there are no displays", () => {
    expect(boundsVisible({ x: 0, y: 0, width: 800, height: 600 }, [])).toBe(false);
  });

  it("checks across multiple displays, matching the second one", () => {
    const second = { x: 1920, y: 0, width: 1920, height: 1080 };
    expect(boundsVisible({ x: 2000, y: 100, width: 800, height: 600 }, [display, second])).toBe(true);
  });

  it("treats an edge-touching rectangle (no overlap area) as not visible", () => {
    // saved.x + saved.width === a.x, so the strict inequality fails on the right edge
    expect(boundsVisible({ x: -800, y: 0, width: 800, height: 600 }, [display])).toBe(false);
  });
});
