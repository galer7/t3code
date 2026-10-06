/**
 * Draw-out: one trace of a thread. Its cards are steps in the order the agent
 * added them; one dimension, so anything else belongs in another trace.
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
