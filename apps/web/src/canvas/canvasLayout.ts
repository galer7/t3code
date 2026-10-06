/**
 * Draw-out: where each card sits. Lanes are columns, left to right: frontend,
 * backend, infra, external. Only lanes with cards take space. A card sits
 * level with the card it follows (`after`, or the first card with an arrow to
 * it) when they are in different lanes, and below it when they share a lane.
 * Cards in a lane never overlap. A pinned card stays where the user put it.
 */
import type {
  CanvasCardRecord as CanvasCard,
  CanvasLane,
  CanvasPoint,
  ThreadCanvasState as ThreadCanvas,
} from "@t3tools/contracts";

export const LANE_ORDER: readonly CanvasLane[] = ["frontend", "backend", "infra", "external"];
export const CARD_WIDTH = 620;
export const LANE_GAP = 160;
export const CARD_GAP = 40;
export const LANE_TOP = 72;
/** The most code lines a card shows before it scrolls. */
export const MAX_VISIBLE_LINES = 26;
export const CODE_LINE_HEIGHT = 19;

export interface LaneColumn {
  readonly lane: CanvasLane;
  readonly x: number;
  readonly height: number;
}

export interface CanvasLayout {
  readonly positions: Readonly<Record<string, CanvasPoint>>;
  readonly lanes: readonly LaneColumn[];
}

export function visibleLineCount(card: Pick<CanvasCard, "startLine" | "endLine">): number {
  return Math.min(card.endLine - card.startLine + 1, MAX_VISIBLE_LINES);
}

/** Height before the card renders: header, caption, code. */
export function estimateCardHeight(card: CanvasCard): number {
  const header = 44;
  const caption = card.caption ? 22 + Math.ceil(card.caption.length / 90) * 18 : 0;
  return header + caption + visibleLineCount(card) * CODE_LINE_HEIGHT + 20;
}

export function layoutCanvas(
  canvas: ThreadCanvas,
  measuredHeights: Readonly<Record<string, number>>,
): CanvasLayout {
  const usedLanes = LANE_ORDER.filter((lane) => canvas.cards.some((card) => card.lane === lane));
  const laneX = new Map(
    usedLanes.map((lane, index) => [lane, index * (CARD_WIDTH + LANE_GAP)] as const),
  );
  const heightOf = (card: CanvasCard) => measuredHeights[card.id] ?? estimateCardHeight(card);
  const byId = new Map(canvas.cards.map((card) => [card.id, card]));
  const positions: Record<string, CanvasPoint> = {};
  const occupied = new Map<CanvasLane, { top: number; bottom: number }[]>(
    usedLanes.map((lane) => [lane, []]),
  );

  const anchorOf = (card: CanvasCard): CanvasCard | null => {
    if (card.after !== null && positions[card.after]) return byId.get(card.after) ?? null;
    const source = canvas.arrows.find((arrow) => arrow.to === card.id && positions[arrow.from]);
    return source ? (byId.get(source.from) ?? null) : null;
  };

  for (const card of canvas.cards) {
    const height = heightOf(card);
    const intervals = occupied.get(card.lane) ?? [];
    const pinned = canvas.pinned[card.id];
    if (pinned) {
      positions[card.id] = pinned;
      intervals.push({ top: pinned.y, bottom: pinned.y + height });
      continue;
    }
    const anchor = anchorOf(card);
    const anchorPoint = anchor ? positions[anchor.id] : undefined;
    let desired: number;
    if (anchor && anchorPoint) {
      desired =
        anchor.lane === card.lane ? anchorPoint.y + heightOf(anchor) + CARD_GAP : anchorPoint.y;
    } else {
      desired = intervals.reduce(
        (bottom, interval) => Math.max(bottom, interval.bottom + CARD_GAP),
        LANE_TOP,
      );
    }
    const y = firstFreeTop(intervals, Math.max(desired, LANE_TOP), height);
    positions[card.id] = { x: laneX.get(card.lane) ?? 0, y };
    intervals.push({ top: y, bottom: y + height });
  }

  const lanes = usedLanes.map((lane) => ({
    lane,
    x: laneX.get(lane) ?? 0,
    height: (occupied.get(lane) ?? []).reduce(
      (bottom, interval) => Math.max(bottom, interval.bottom + CARD_GAP),
      LANE_TOP + 200,
    ),
  }));
  return { positions, lanes };
}

function firstFreeTop(
  intervals: readonly { top: number; bottom: number }[],
  desired: number,
  height: number,
): number {
  const sorted = [...intervals].sort((a, b) => a.top - b.top);
  let top = desired;
  for (const interval of sorted) {
    const overlaps = top < interval.bottom + CARD_GAP && top + height + CARD_GAP > interval.top;
    if (overlaps) top = interval.bottom + CARD_GAP;
  }
  return top;
}
