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

export interface TracePlace {
  readonly column: number;
  readonly row: number;
}

/**
 * The step ← or → leads to. It follows the current card's own arrow into the
 * next (or previous) step, so a branch stays on its path. With no such arrow,
 * it keeps the same row when that row exists, else the first row.
 */
export function stepAcross(
  canvas: ThreadCanvasState,
  columns: readonly (readonly string[])[],
  place: TracePlace,
  direction: "left" | "right",
): TracePlace {
  const target = direction === "right" ? place.column + 1 : place.column - 1;
  const targetColumn = columns[target];
  if (!targetColumn) return place;
  const current = columns[place.column]?.[place.row];
  const linked = canvas.arrows
    .flatMap((arrow) =>
      direction === "right"
        ? arrow.from === current
          ? [arrow.to]
          : []
        : arrow.to === current
          ? [arrow.from]
          : [],
    )
    .concat(
      canvas.cards.flatMap((card) =>
        direction === "right"
          ? card.after === current
            ? [card.id]
            : []
          : card.id === current && card.after
            ? [card.after]
            : [],
      ),
    );
  const followed = targetColumn.findIndex((id) => linked.includes(id));
  if (followed >= 0) return { column: target, row: followed };
  return { column: target, row: place.row < targetColumn.length ? place.row : 0 };
}
