import { describe, expect, it } from "vite-plus/test";

import { applyDrop, autoColumns, dropAt, layoutColumns, type GalleryItem } from "./galleryLayout";

const item = (id: string, height: number): GalleryItem => ({ id, height });

describe("autoColumns", () => {
  it("keeps the order down each column and makes the tallest column short", () => {
    const items = [item("a", 300), item("b", 100), item("c", 100), item("d", 100)];
    expect(autoColumns(items, 2)).toEqual([["a"], ["b", "c", "d"]]);
    expect(autoColumns(items, 9)).toEqual([["a"], ["b"], ["c"], ["d"]]);
  });
});

describe("layoutColumns", () => {
  it("fills the width and stretches short columns to the tallest", () => {
    const heights = new Map([
      ["a", 300],
      ["b", 100],
      ["c", 50],
    ]);
    const layout = layoutColumns([["a"], ["b", "c"]], heights, [1, 1], 1000);
    expect(layout.rects.get("a")).toEqual({ x: 0, y: 0, width: 500, height: 300 });
    expect(layout.rects.get("b")).toEqual({ x: 500, y: 0, width: 500, height: 200 });
    expect(layout.rects.get("c")).toEqual({ x: 500, y: 200, width: 500, height: 100 });
    expect(layout.height).toBe(300);
  });
});

describe("dropping an editor", () => {
  const heights = new Map([
    ["a", 100],
    ["b", 100],
    ["c", 100],
  ]);
  const layout = layoutColumns([["a", "b"], ["c"]], heights, [1, 1], 1000);

  it("puts it in a column above the editor under the pointer's upper half", () => {
    const drop = dropAt(layout, "c", 250, 120, 40);
    expect(drop).toEqual({ kind: "editor", column: 0, index: 1 });
    expect(applyDrop(layout.columns, [1, 1], "c", drop).columns).toEqual([["a", "c", "b"]]);
  });

  it("opens a new column near a column's side", () => {
    const drop = dropAt(layout, "a", 990, 50, 40);
    expect(drop).toEqual({ kind: "column", index: 2 });
    expect(applyDrop(layout.columns, [1, 1], "a", drop).columns).toEqual([["b"], ["c"], ["a"]]);
  });
});
