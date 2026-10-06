/**
 * Draw-out: the overview of a trace as a sequence diagram. Lanes are
 * lifelines, left to right: frontend, backend, infra, external. Each step is
 * one row, in the order of the flow; arrows show the hops between steps.
 * ↑ ↓ select a step, Enter or a click opens it, Esc goes back to the steps.
 */
import type { CanvasCardRecord, CanvasLane, ThreadCanvasState } from "@t3tools/contracts";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "~/lib/utils";

import { LANE_ORDER, LANE_STYLES } from "./laneStyles";
import { useProjectPath } from "./projectPath";
import { traceColumns } from "./traceSteps";

const ROW_HEIGHT = 116;
const HEADER_HEIGHT = 56;
const BOX_MARGIN = 36;

interface Row {
  readonly card: CanvasCardRecord;
  readonly label: string;
}

export function SequenceView(props: {
  readonly canvas: ThreadCanvasState;
  readonly currentCardId: string | null;
  readonly onOpen: (cardId: string) => void;
  readonly onBack: () => void;
}) {
  const { canvas, currentCardId, onOpen, onBack } = props;
  const zoneRef = useRef<HTMLDivElement | null>(null);
  const projectPath = useProjectPath();
  const [width, setWidth] = useState(800);

  const rows = useMemo<Row[]>(() => {
    const byId = new Map(canvas.cards.map((card) => [card.id, card]));
    return traceColumns(canvas).flatMap((column, step) =>
      column.flatMap((id, branch) => {
        const card = byId.get(id);
        if (!card) return [];
        const letter = column.length > 1 ? String.fromCharCode(97 + branch) : "";
        return [{ card, label: `${step + 1}${letter}` }];
      }),
    );
  }, [canvas]);
  const lanes = useMemo<CanvasLane[]>(
    () => LANE_ORDER.filter((lane) => canvas.cards.some((card) => card.lane === lane)),
    [canvas.cards],
  );
  const [selected, setSelected] = useState(() =>
    Math.max(
      0,
      rows.findIndex((row) => row.card.id === currentCardId),
    ),
  );

  useEffect(() => {
    const zone = zoneRef.current;
    if (!zone) return;
    zone.focus();
    const observer = new ResizeObserver(() => setWidth(zone.clientWidth));
    observer.observe(zone);
    setWidth(zone.clientWidth);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    zoneRef.current
      ?.querySelector(`[data-row="${selected}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);

  const laneWidth = width / Math.max(lanes.length, 1);
  const laneX = (lane: CanvasLane) => lanes.indexOf(lane) * laneWidth;
  const rowIndex = new Map(rows.map((row, index) => [row.card.id, index]));
  const rowTop = (index: number) => HEADER_HEIGHT + index * ROW_HEIGHT;
  const height = rowTop(rows.length) + 24;

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      setSelected((index) => Math.min(index + 1, rows.length - 1));
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      setSelected((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const row = rows[selected];
      if (row) onOpen(row.card.id);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onBack();
    }
  };

  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No trace yet.
      </div>
    );
  }

  return (
    <div
      ref={zoneRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="relative h-full overflow-y-auto bg-background outline-none"
    >
      <div className="relative" style={{ height }}>
        {/* Lifelines and lane headers. */}
        {lanes.map((lane) => (
          <div
            key={lane}
            className="absolute top-0 bottom-0"
            style={{ left: laneX(lane), width: laneWidth }}
          >
            <div className="sticky top-0 z-10 flex h-14 items-center justify-center gap-2 border-b border-border/60 bg-background/95 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground backdrop-blur">
              <span
                className="size-2 rounded-full"
                style={{ background: LANE_STYLES[lane].color }}
              />
              {LANE_STYLES[lane].label}
            </div>
            <div
              className="absolute top-14 bottom-0 left-1/2 border-l border-dashed"
              style={{ borderColor: `${LANE_STYLES[lane].color}40` }}
            />
          </div>
        ))}
        {/* Hops. */}
        <svg className="pointer-events-none absolute inset-0 z-[5]" width={width} height={height}>
          <defs>
            <marker
              id="drawout-seq-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path
                d="M 0 0 L 10 5 L 0 10 z"
                fill="currentColor"
                className="text-muted-foreground"
              />
            </marker>
          </defs>
          {canvas.arrows.map((arrow) => {
            const from = rowIndex.get(arrow.from);
            const to = rowIndex.get(arrow.to);
            const fromCard = rows[from ?? -1]?.card;
            const toCard = rows[to ?? -1]?.card;
            if (from === undefined || to === undefined || !fromCard || !toCard) return null;
            const fromCenter = laneX(fromCard.lane) + laneWidth / 2;
            const toCenter = laneX(toCard.lane) + laneWidth / 2;
            const boxHalf = laneWidth / 2 - BOX_MARGIN;
            let path: string;
            let labelX: number;
            let labelY: number;
            if (fromCard.lane === toCard.lane && Math.abs(to - from) === 1) {
              // The next row in the same lane: straight down the lifeline.
              const x = fromCenter;
              const y1 = rowTop(Math.min(from, to)) + ROW_HEIGHT - 10;
              const y2 = rowTop(Math.max(from, to)) + 10;
              path = to > from ? `M ${x} ${y1} L ${x} ${y2}` : `M ${x} ${y2} L ${x} ${y1}`;
              labelX = x + 100;
              labelY = (y1 + y2) / 2;
            } else if (fromCard.lane === toCard.lane) {
              // A later row in the same lane: around the boxes, in the left margin.
              const x = laneX(fromCard.lane) + BOX_MARGIN;
              const y1 = rowTop(from) + ROW_HEIGHT / 2;
              const y2 = rowTop(to) + ROW_HEIGHT / 2;
              path = `M ${x} ${y1} C ${x - 30} ${y1}, ${x - 30} ${y2}, ${x} ${y2}`;
              labelX = x + 70;
              labelY = (y1 + y2) / 2;
            } else {
              const rightward = toCenter > fromCenter;
              const x1 = fromCenter + (rightward ? boxHalf : -boxHalf);
              const x2 = toCenter + (rightward ? -boxHalf : boxHalf);
              const y1 = rowTop(from) + ROW_HEIGHT / 2;
              const y2 = rowTop(to) + ROW_HEIGHT / 2;
              const bend = (x2 - x1) / 2;
              path = `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
              labelX = (x1 + x2) / 2;
              labelY = (y1 + y2) / 2;
            }
            return (
              <g key={arrow.id} className="text-muted-foreground">
                <path
                  d={path}
                  fill="none"
                  stroke="currentColor"
                  strokeOpacity={0.55}
                  strokeWidth={1.5}
                  markerEnd="url(#drawout-seq-arrow)"
                />
                {arrow.label ? (
                  <foreignObject x={labelX - 90} y={labelY - 12} width={180} height={24}>
                    <div className="flex h-full items-center justify-center">
                      <span className="truncate rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                        {arrow.label}
                      </span>
                    </div>
                  </foreignObject>
                ) : null}
              </g>
            );
          })}
        </svg>
        {/* Steps. */}
        {rows.map((row, index) => {
          const active = index === selected;
          return (
            <button
              key={row.card.id}
              type="button"
              data-row={index}
              onClick={() => onOpen(row.card.id)}
              onMouseEnter={() => setSelected(index)}
              className={cn(
                "absolute flex flex-col items-start gap-1 overflow-hidden rounded-xl border bg-card px-3.5 py-2.5 text-left shadow-sm transition-colors",
                active
                  ? "border-primary/70 ring-2 ring-primary/25"
                  : "border-border/70 hover:border-border",
              )}
              style={{
                left: laneX(row.card.lane) + BOX_MARGIN,
                top: rowTop(index) + 10,
                width: laneWidth - BOX_MARGIN * 2,
                height: ROW_HEIGHT - 20,
              }}
            >
              <div className="flex w-full items-baseline gap-2">
                <span className="shrink-0 rounded bg-muted px-1.5 font-mono text-[11px] text-muted-foreground">
                  {row.label}
                </span>
                <span className="truncate text-[15px] font-semibold">
                  {row.card.title ?? row.card.path.split("/").pop()}
                </span>
              </div>
              <span
                className="w-full truncate font-mono text-[11px] text-muted-foreground"
                style={{ direction: "rtl", textAlign: "left" }}
              >
                <bdi>
                  {projectPath(row.card.path)}:{row.card.startLine}–{row.card.endLine}
                </bdi>
              </span>
              {row.card.caption ? (
                <span className="line-clamp-2 text-[13px] leading-[17px] text-muted-foreground">
                  {row.card.caption}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
