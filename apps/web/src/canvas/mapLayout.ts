/**
 * Draw-out: where each editor sits on the map. The map is columns of
 * editors that fill its width, with no space anywhere: every column ends at
 * the same height, so editors in shorter columns stretch and show more of
 * their file.
 *
 * With no arrangement from the user, the map picks the columns itself: as
 * many as fit at the zoom, the editors in order down each column, split so
 * the tallest column is as short as it can be. Once the user drops an editor
 * somewhere, their columns stay, and the zoom only scales them.
 */
export interface MapItem {
  readonly id: string;
  /** The editor's own height, before it stretches to fill its column. */
  readonly height: number;
}

export interface MapRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface MapLayout {
  readonly columns: readonly (readonly string[])[];
  readonly rects: ReadonlyMap<string, MapRect>;
  /** Each column's left edge and width. */
  readonly columnRects: readonly { readonly x: number; readonly width: number }[];
  readonly width: number;
  readonly height: number;
}

/**
 * Split the items, in order, into `count` columns so the tallest column is
 * as short as it can be.
 */
export function autoColumns(items: readonly MapItem[], count: number): string[][] {
  const n = items.length;
  const k = Math.max(1, Math.min(count, n));
  if (n === 0) return [];
  const prefix = [0];
  for (const item of items) prefix.push(prefix.at(-1)! + item.height);
  const sum = (from: number, to: number) => prefix[to]! - prefix[from]!;
  // best[j][i]: the shortest tallest column for the first i items in j columns.
  const best: number[][] = [Array.from({ length: n + 1 }, (_, i) => (i === 0 ? 0 : Infinity))];
  const cut: number[][] = [[]];
  for (let j = 1; j <= k; j++) {
    best.push(Array.from({ length: n + 1 }, () => Infinity));
    cut.push(Array.from({ length: n + 1 }, () => 0));
    for (let i = j; i <= n; i++) {
      for (let p = j - 1; p < i; p++) {
        const value = Math.max(best[j - 1]![p]!, sum(p, i));
        if (value < best[j]![i]!) {
          best[j]![i] = value;
          cut[j]![i] = p;
        }
      }
    }
  }
  const columns: string[][] = [];
  let end = n;
  for (let j = k; j >= 1; j--) {
    const start = cut[j]![end]!;
    columns.unshift(items.slice(start, end).map((item) => item.id));
    end = start;
  }
  return columns;
}

/**
 * Place the columns across `width`, each as wide as its share of `weights`,
 * and stretch every column to the tallest one.
 */
export function layoutColumns(
  columns: readonly (readonly string[])[],
  heights: ReadonlyMap<string, number>,
  weights: readonly number[],
  width: number,
): MapLayout {
  const totals = columns.map((column) =>
    column.reduce((total, id) => total + (heights.get(id) ?? 0), 0),
  );
  const height = Math.max(0, ...totals);
  const weightOf = (index: number) => weights[index] ?? 1;
  const weightSum = columns.reduce((total, _column, index) => total + weightOf(index), 0);
  const rects = new Map<string, MapRect>();
  const columnRects: { x: number; width: number }[] = [];
  let left = 0;
  columns.forEach((column, index) => {
    const right =
      index === columns.length - 1
        ? width
        : Math.round(left + (width * weightOf(index)) / weightSum);
    columnRects.push({ x: left, width: right - left });
    const scale = totals[index]! > 0 ? height / totals[index]! : 1;
    let natural = 0;
    let top = 0;
    for (const id of column) {
      natural += heights.get(id) ?? 0;
      const bottom = Math.round(natural * scale);
      rects.set(id, { x: left, y: top, width: right - left, height: bottom - top });
      top = bottom;
    }
    left = right;
  });
  return { columns, rects, columnRects, width, height };
}

export type MapDrop =
  | { readonly kind: "column"; readonly index: number }
  | { readonly kind: "editor"; readonly column: number; readonly index: number };

/**
 * Where a dragged editor would land for a pointer at (x, y): a new column
 * when the pointer is near a column's side, else a place in that column.
 */
export function dropAt(layout: MapLayout, id: string, x: number, y: number, edge: number): MapDrop {
  const columnIndex = Math.max(
    0,
    layout.columnRects.findLastIndex((column) => x >= column.x),
  );
  const column = layout.columnRects[columnIndex];
  if (!column) return { kind: "column", index: 0 };
  const reach = Math.min(edge, column.width / 4);
  if (x < column.x + reach) return { kind: "column", index: columnIndex };
  if (x > column.x + column.width - reach) return { kind: "column", index: columnIndex + 1 };
  const others = (layout.columns[columnIndex] ?? []).filter((other) => other !== id);
  const index = others.findIndex((other) => {
    const rect = layout.rects.get(other);
    return rect !== undefined && y < rect.y + rect.height / 2;
  });
  return { kind: "editor", column: columnIndex, index: index < 0 ? others.length : index };
}

/** The columns and their weights after the editor `id` lands at `drop`. */
export function applyDrop(
  columns: readonly (readonly string[])[],
  weights: readonly number[],
  id: string,
  drop: MapDrop,
): { columns: string[][]; weights: number[] } {
  let next = columns.map((column) => column.filter((other) => other !== id));
  let nextWeights = columns.map((_column, index) => weights[index] ?? 1);
  if (drop.kind === "column") {
    const share =
      nextWeights.reduce((total, weight) => total + weight, 0) / Math.max(1, nextWeights.length);
    next.splice(drop.index, 0, [id]);
    nextWeights.splice(drop.index, 0, share);
  } else {
    next[drop.column]?.splice(drop.index, 0, id);
  }
  const kept = next.map((column) => column.length > 0);
  next = next.filter((_column, index) => kept[index]);
  nextWeights = nextWeights.filter((_weight, index) => kept[index]);
  return { columns: next, weights: nextWeights };
}
