/**
 * Draw-out: where each editor sits on the map. Editors touch, with no space
 * between them. An editor the user placed stays where they put it; the rest
 * pack around it in order, each at the highest free spot, left first. Then
 * each packed editor grows right and down into the free space beside it, so
 * the map has no holes and a grown editor shows more of its file.
 */
export interface MapItem {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  /** Where the user put the editor. */
  readonly pinned?: { readonly x: number; readonly y: number } | undefined;
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

const overlaps = (a: MapRect, b: MapRect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Lay out the items inside a map at least `viewWidth` wide. */
export function layoutMap(items: readonly MapItem[], viewWidth: number): MapLayout {
  const mapWidth = Math.max(
    viewWidth,
    ...items.map((item) => (item.pinned ? item.pinned.x : 0) + item.width),
  );
  const rects = new Map<string, MapRect>();
  const placed: MapRect[] = [];
  for (const item of items) {
    if (!item.pinned) continue;
    const rect = { ...item.pinned, width: item.width, height: item.height };
    rects.set(item.id, rect);
    placed.push(rect);
  }

  const packed: string[] = [];
  for (const item of items) {
    if (item.pinned) continue;
    const xs = [0, ...placed.map((rect) => rect.x + rect.width)];
    const ys = [0, ...placed.map((rect) => rect.y + rect.height)];
    let best: MapRect | null = null;
    for (const y of ys) {
      for (const x of xs) {
        if (x > 0 && x + item.width > mapWidth) continue;
        if (best && (y > best.y || (y === best.y && x >= best.x))) continue;
        const rect: MapRect = { x, y, width: item.width, height: item.height };
        if (placed.some((other) => overlaps(rect, other))) continue;
        best = rect;
      }
    }
    // Below everything always fits.
    best ??= {
      x: 0,
      y: Math.max(0, ...placed.map((rect) => rect.y + rect.height)),
      width: item.width,
      height: item.height,
    };
    rects.set(item.id, best);
    placed.push(best);
    packed.push(item.id);
  }

  // Grow each packed editor into the free space to its right, then below it.
  let bottom = Math.max(0, ...placed.map((rect) => rect.y + rect.height));
  for (const id of packed) {
    const rect = rects.get(id)!;
    const others = [...rects].filter(([otherId]) => otherId !== id).map(([, other]) => other);
    const right = Math.min(
      mapWidth,
      ...others
        .filter(
          (other) =>
            other.x >= rect.x + rect.width &&
            other.y < rect.y + rect.height &&
            rect.y < other.y + other.height,
        )
        .map((other) => other.x),
    );
    const wide = { ...rect, width: right - rect.x };
    const below = Math.min(
      bottom,
      ...others
        .filter(
          (other) =>
            other.y >= wide.y + wide.height &&
            other.x < wide.x + wide.width &&
            wide.x < other.x + other.width,
        )
        .map((other) => other.y),
    );
    rects.set(id, { ...wide, height: Math.max(wide.height, below - wide.y) });
  }
  bottom = Math.max(0, ...[...rects.values()].map((rect) => rect.y + rect.height));
  return { rects, width: mapWidth, height: bottom };
}

/**
 * Where a dragged editor lands: its edges snap to the map's edges and to the
 * other editors' edges within `reach`, and it never covers another placed
 * editor; it moves down below one instead.
 */
export function snapRect(
  rect: MapRect,
  others: readonly MapRect[],
  pinnedOthers: readonly MapRect[],
  reach: number,
): { x: number; y: number } {
  const nearest = (value: number, candidates: readonly number[]) => {
    let best = value;
    let distance = reach;
    for (const candidate of candidates) {
      if (Math.abs(candidate - value) > distance) continue;
      best = candidate;
      distance = Math.abs(candidate - value);
    }
    return best;
  };
  const x = Math.max(
    0,
    nearest(rect.x, [
      0,
      ...others.flatMap((other) => [
        other.x,
        other.x + other.width,
        other.x - rect.width,
        other.x + other.width - rect.width,
      ]),
    ]),
  );
  let y = Math.max(
    0,
    nearest(rect.y, [
      0,
      ...others.flatMap((other) => [
        other.y,
        other.y + other.height,
        other.y - rect.height,
        other.y + other.height - rect.height,
      ]),
    ]),
  );
  for (;;) {
    const blocker = pinnedOthers.find((other) => overlaps({ ...rect, x, y }, other));
    if (!blocker) return { x, y };
    y = blocker.y + blocker.height;
  }
}
