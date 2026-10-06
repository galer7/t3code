/**
 * Draw-out: the agent's cards as a trace you walk with the keyboard. A card's
 * step is how far it is from the start of the flow (the longest chain of
 * arrows or `after` links into it). Cards at the same step are branches.
 */
import type { ThreadCanvasState } from "@t3tools/contracts";

/** Columns of card ids: index is the step, order inside is the branch. */
export function traceColumns(canvas: ThreadCanvasState): string[][] {
  const ids = new Set(canvas.cards.map((card) => card.id));
  const predecessors = new Map<string, string[]>();
  const link = (from: string, to: string) => {
    if (!ids.has(from) || !ids.has(to) || from === to) return;
    predecessors.set(to, [...(predecessors.get(to) ?? []), from]);
  };
  for (const card of canvas.cards) if (card.after) link(card.after, card.id);
  for (const arrow of canvas.arrows) link(arrow.from, arrow.to);

  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (id: string): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0; // A cycle: cut it here.
    visiting.add(id);
    const value = Math.max(-1, ...(predecessors.get(id) ?? []).map(depthOf)) + 1;
    visiting.delete(id);
    depth.set(id, value);
    return value;
  };

  const columns: string[][] = [];
  for (const card of canvas.cards) {
    const step = depthOf(card.id);
    (columns[step] ??= []).push(card.id);
  }
  return columns.filter((column) => column.length > 0);
}
