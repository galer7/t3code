import { describe, expect, it } from "vite-plus/test";

import { layoutMap, type MapItem, type MapRect, snapRect } from "./mapLayout";

const item = (id: string, width: number, height: number, pinned?: MapItem["pinned"]) => ({
  id,
  width,
  height,
  pinned,
});

const overlaps = (a: MapRect, b: MapRect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe("layoutMap", () => {
  it("packs a short editor into the gap beside a tall one, with no space", () => {
    const layout = layoutMap([item("a", 100, 300), item("b", 100, 100), item("c", 100, 100)], 200);
    expect(layout.rects.get("b")).toMatchObject({ x: 100, y: 0 });
    expect(layout.rects.get("c")).toMatchObject({ x: 100, y: 100 });
  });

  it("grows editors into the free space right and below", () => {
    const layout = layoutMap([item("a", 100, 300), item("b", 100, 100)], 250);
    expect(layout.rects.get("b")).toEqual({ x: 100, y: 0, width: 150, height: 300 });
  });

  it("keeps a placed editor where the user put it and packs the rest around it", () => {
    const layout = layoutMap(
      [item("a", 100, 100), item("b", 100, 100, { x: 0, y: 0 }), item("c", 100, 100)],
      200,
    );
    expect(layout.rects.get("b")).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(layout.rects.get("a")).toMatchObject({ x: 100, y: 0 });
    expect(layout.rects.get("c")).toMatchObject({ x: 0, y: 100 });
  });

  it("never overlaps editors of mixed sizes", () => {
    const items = Array.from({ length: 20 }, (_, index) =>
      item(
        `c${index}`,
        200 + ((index * 137) % 300),
        80 + ((index * 71) % 400),
        index % 7 === 3 ? { x: (index * 97) % 900, y: (index * 53) % 700 } : undefined,
      ),
    );
    const rects = [...layoutMap(items, 1400).rects.values()];
    for (const [index, rect] of rects.entries()) {
      for (const other of rects.slice(index + 1)) expect(overlaps(rect, other)).toBe(false);
    }
  });
});

describe("snapRect", () => {
  it("snaps to a neighbour's edge and moves below a placed editor it covers", () => {
    const other = { x: 0, y: 0, width: 100, height: 100 };
    expect(snapRect({ x: 106, y: 4, width: 50, height: 50 }, [other], [], 10)).toEqual({
      x: 100,
      y: 0,
    });
    expect(snapRect({ x: 40, y: 40, width: 50, height: 50 }, [other], [other], 10)).toEqual({
      x: 50,
      y: 100,
    });
  });
});
