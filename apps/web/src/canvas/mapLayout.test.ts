import { describe, expect, it } from "vite-plus/test";

import { layoutMap, MAP_GAP, MAP_PAD, type MapItem, moveInOrder } from "./mapLayout";

const item = (id: string, width: number, height: number, path = `/repo/${id}.ts`): MapItem => ({
  id,
  path,
  startLine: 1,
  width,
  height,
});

const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe("layoutMap", () => {
  it("packs a short editor into the gap beside a tall one", () => {
    const view = 2 * MAP_PAD + 2 * 100 + MAP_GAP;
    const layout = layoutMap(
      [item("a", 100, 300), item("b", 100, 100), item("c", 100, 100)],
      "pack",
      view,
    );
    expect(layout.rects.get("b")).toMatchObject({ x: MAP_PAD + 100 + MAP_GAP, y: MAP_PAD });
    expect(layout.rects.get("c")).toMatchObject({
      x: MAP_PAD + 100 + MAP_GAP,
      y: MAP_PAD + 100 + MAP_GAP,
    });
  });

  it("never overlaps editors of mixed sizes", () => {
    const items = Array.from({ length: 20 }, (_, index) =>
      item(`c${index}`, 200 + ((index * 137) % 300), 80 + ((index * 71) % 400)),
    );
    for (const kind of ["pack", "rows", "files"] as const) {
      const rects = [...layoutMap(items, kind, 1400).rects.values()];
      for (const [index, rect] of rects.entries()) {
        for (const other of rects.slice(index + 1)) expect(overlaps(rect, other)).toBe(false);
      }
    }
  });

  it("gives each file one column", () => {
    const layout = layoutMap(
      [item("a", 100, 50, "/x.ts"), item("b", 100, 50, "/y.ts"), item("c", 100, 50, "/x.ts")],
      "files",
      1000,
    );
    expect(layout.rects.get("c")?.x).toBe(layout.rects.get("a")?.x);
    expect(layout.rects.get("b")?.x).toBe(MAP_PAD + 100 + MAP_GAP);
  });
});

describe("moveInOrder", () => {
  it("moves forward and back", () => {
    expect(moveInOrder(["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"]);
    expect(moveInOrder(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
  });
});
