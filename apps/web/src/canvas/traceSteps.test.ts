import { type ThreadCanvasState, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { stepAcross, traceCards, traceColumns } from "./traceSteps";

const card = (id: string, trace: string) => ({
  id,
  path: `/repo/${id}.rb`,
  startLine: 1,
  endLine: 2,
  lane: "backend" as const,
  title: null,
  caption: null,
  after: null,
  trace,
});

const canvas: ThreadCanvasState = {
  threadId: ThreadId.make("thread"),
  cards: [card("c1", "t1"), card("c2", "t2"), card("c3", "t1")],
  arrows: [],
  pinned: {},
  nextCard: 4,
  nextArrow: 1,
  revision: 1,
  traces: [
    { id: "t1", title: "One" },
    { id: "t2", title: "Two" },
  ],
  marks: [{ id: "m1", cardId: "c2", startLine: 1, endLine: 1, text: "x", tone: "info" }],
};

describe("a trace's steps", () => {
  it("are its cards in order, one per step", () => {
    const one = traceCards(canvas, "t1");
    expect(traceColumns(one)).toEqual([["c1"], ["c3"]]);
    expect(one.marks).toEqual([]);
  });

  it("walk left and right and stop at the ends", () => {
    const columns = traceColumns(traceCards(canvas, "t1"));
    expect(stepAcross(canvas, columns, { column: 0, row: 0 }, "right")).toEqual({
      column: 1,
      row: 0,
    });
    expect(stepAcross(canvas, columns, { column: 1, row: 0 }, "right")).toEqual({
      column: 1,
      row: 0,
    });
  });
});
