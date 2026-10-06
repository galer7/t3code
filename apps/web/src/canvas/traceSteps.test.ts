import { type ThreadCanvasState, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { stepAcross, traceColumns } from "./traceSteps";

const card = (id: string, after: string | null = null) => ({
  id,
  path: `/repo/${id}.rb`,
  startLine: 1,
  endLine: 2,
  lane: "backend" as const,
  title: null,
  caption: null,
  after,
});

// Two paths that cross rows: the form (c1) posts to c5, the camera (c3) to c4.
const canvas: ThreadCanvasState = {
  threadId: ThreadId.make("thread"),
  cards: [card("c1"), card("c2"), card("c3"), card("c4"), card("c5")],
  arrows: [
    { id: "a1", from: "c2", to: "c1", label: null },
    { id: "a2", from: "c1", to: "c5", label: null },
    { id: "a3", from: "c3", to: "c4", label: null },
    { id: "a4", from: "c2", to: "c3", label: null },
  ],
  pinned: {},
  nextCard: 6,
  nextArrow: 5,
  revision: 1,
};

describe("trace steps", () => {
  const columns = traceColumns(canvas);

  it("puts cards at the same distance from the start on one step", () => {
    expect(columns).toEqual([["c2"], ["c1", "c3"], ["c4", "c5"]]);
  });

  it("follows the current card's arrow to the right, even to another row", () => {
    expect(stepAcross(canvas, columns, { column: 1, row: 1 }, "right")).toEqual({
      column: 2,
      row: 0,
    });
    expect(stepAcross(canvas, columns, { column: 1, row: 0 }, "right")).toEqual({
      column: 2,
      row: 1,
    });
  });

  it("follows the arrow it came in on to the left", () => {
    expect(stepAcross(canvas, columns, { column: 2, row: 0 }, "left")).toEqual({
      column: 1,
      row: 1,
    });
  });

  it("keeps the row when there is no arrow, or takes the first row", () => {
    const loose: ThreadCanvasState = { ...canvas, arrows: [canvas.arrows[0]!, canvas.arrows[3]!] };
    const looseColumns = [["c2"], ["c1", "c3"], ["c4", "c5"]];
    expect(stepAcross(loose, looseColumns, { column: 1, row: 1 }, "right")).toEqual({
      column: 2,
      row: 1,
    });
    expect(stepAcross(loose, looseColumns, { column: 0, row: 0 }, "right")).toEqual({
      column: 1,
      row: 0,
    });
  });

  it("stays put at either end", () => {
    expect(stepAcross(canvas, columns, { column: 2, row: 0 }, "right")).toEqual({
      column: 2,
      row: 0,
    });
    expect(stepAcross(canvas, columns, { column: 0, row: 0 }, "left")).toEqual({
      column: 0,
      row: 0,
    });
  });
});
