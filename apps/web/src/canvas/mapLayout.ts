/**
 * Draw-out: where each editor sits on the map. The map keeps the agent's
 * order (or the user's, after a drag) and packs the editors by their sizes:
 *
 * - `pack`: each editor goes to the highest free spot, left first, so mixed
 *   sizes fill the gaps. Reading order stays roughly left to right, top down.
 * - `rows`: left to right, wrapping at the map's width.
 * - `files`: one column per file, its ranges top down in line order.
 */
export type MapLayoutKind = "pack" | "rows" | "files";

export interface MapItem {
  readonly id: string;
  readonly path: string;
  readonly startLine: number;
  readonly width: number;
  readonly height: number;
}

export interface MapRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface MapLayout {
  readonly rects: ReadonlyMap<string, MapRect>;
  readonly width: number;
  readonly height: number;
}

export const MAP_PAD = 24;
export const MAP_GAP = 16;

/** Lay out the items in order inside a map at least `viewWidth` wide. */
export function layoutMap(
  items: readonly MapItem[],
  kind: MapLayoutKind,
  viewWidth: number,
): MapLayout {
  const widest = Math.max(0, ...items.map((item) => item.width));
  const mapWidth = Math.max(viewWidth, widest + 2 * MAP_PAD);
  const rects = new Map<string, MapRect>();
  if (kind === "files") layoutFiles(items, rects);
  else if (kind === "rows") layoutRows(items, mapWidth, rects);
  else layoutPack(items, mapWidth, rects);
  let right = 0;
  let bottom = 0;
  for (const rect of rects.values()) {
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
  }
  return { rects, width: Math.max(mapWidth, right + MAP_PAD), height: bottom + MAP_PAD };
}

interface Segment {
  x: number;
  end: number;
  y: number;
}

function layoutPack(items: readonly MapItem[], mapWidth: number, rects: Map<string, MapRect>) {
  // The skyline: the lowest free y over each stretch of x.
  let skyline: Segment[] = [{ x: MAP_PAD, end: mapWidth - MAP_PAD, y: MAP_PAD }];
  for (const item of items) {
    let best: { x: number; y: number } | null = null;
    for (const segment of skyline) {
      const x = segment.x;
      if (x + item.width > mapWidth - MAP_PAD && x !== MAP_PAD) continue;
      const y = Math.max(
        ...skyline.filter((other) => other.end > x && other.x < x + item.width).map((s) => s.y),
      );
      if (!best || y < best.y || (y === best.y && x < best.x)) best = { x, y };
    }
    const { x, y } = best ?? { x: MAP_PAD, y: MAP_PAD };
    rects.set(item.id, { x, y, width: item.width, height: item.height });
    const top = y + item.height + MAP_GAP;
    const end = x + item.width + MAP_GAP;
    const next: Segment[] = [];
    for (const segment of skyline) {
      if (segment.end <= x || segment.x >= end) {
        next.push(segment);
        continue;
      }
      if (segment.x < x) next.push({ x: segment.x, end: x, y: segment.y });
      if (segment.end > end) next.push({ x: end, end: segment.end, y: segment.y });
    }
    next.push({ x, end: Math.max(end, x + 1), y: top });
    next.sort((a, b) => a.x - b.x);
    // Join neighbours at the same height.
    skyline = next.reduce<Segment[]>((joined, segment) => {
      const last = joined.at(-1);
      if (last && last.y === segment.y && last.end >= segment.x) last.end = segment.end;
      else joined.push({ ...segment });
      return joined;
    }, []);
  }
}

function layoutRows(items: readonly MapItem[], mapWidth: number, rects: Map<string, MapRect>) {
  let x = MAP_PAD;
  let y = MAP_PAD;
  let rowHeight = 0;
  for (const item of items) {
    if (x > MAP_PAD && x + item.width > mapWidth - MAP_PAD) {
      x = MAP_PAD;
      y += rowHeight + MAP_GAP;
      rowHeight = 0;
    }
    rects.set(item.id, { x, y, width: item.width, height: item.height });
    x += item.width + MAP_GAP;
    rowHeight = Math.max(rowHeight, item.height);
  }
}

function layoutFiles(items: readonly MapItem[], rects: Map<string, MapRect>) {
  const files = new Map<string, MapItem[]>();
  for (const item of items) files.set(item.path, [...(files.get(item.path) ?? []), item]);
  let x = MAP_PAD;
  for (const ranges of files.values()) {
    let y = MAP_PAD;
    const width = Math.max(...ranges.map((item) => item.width));
    for (const item of ranges.toSorted((a, b) => a.startLine - b.startLine)) {
      rects.set(item.id, { x, y, width: item.width, height: item.height });
      y += item.height + MAP_GAP;
    }
    x += width + MAP_GAP;
  }
}

/** The order with `id` moved to where `target` is. */
export function moveInOrder(order: readonly string[], id: string, target: string): string[] {
  const from = order.indexOf(id);
  const to = order.indexOf(target);
  if (from < 0 || to < 0 || from === to) return [...order];
  const next = order.filter((other) => other !== id);
  next.splice(to, 0, id);
  return next;
}
