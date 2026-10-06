/**
 * Draw-out: a trace's cards as steps you walk with ← →, in the order the
 * agent added them. One dimension: anything else belongs in another trace.
 */
import type { ThreadCanvasState } from "@t3tools/contracts";

/** The cards of `traceId` in order, or every card when it is null. */
export function traceCards(canvas: ThreadCanvasState, traceId: string | null): ThreadCanvasState {
  if (traceId === null) return canvas;
  const cards = canvas.cards.filter((card) => card.trace === traceId);
  const ids = new Set(cards.map((card) => card.id));
  return {
    ...canvas,
    cards,
    arrows: [],
    marks: (canvas.marks ?? []).filter((mark) => ids.has(mark.cardId)),
  };
}

/** Columns of card ids: index is the step. Each step has one card. */
export function traceColumns(canvas: ThreadCanvasState): string[][] {
  return canvas.cards.map((card) => [card.id]);
}

export interface TracePlace {
  readonly column: number;
  readonly row: number;
}

/** The step ← or → leads to. */
export function stepAcross(
  _canvas: ThreadCanvasState,
  columns: readonly (readonly string[])[],
  place: TracePlace,
  direction: "left" | "right",
): TracePlace {
  const target = direction === "right" ? place.column + 1 : place.column - 1;
  return columns[target] ? { column: target, row: 0 } : place;
}
