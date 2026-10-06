/**
 * Draw-out: the map of a thread's trace. Each card is an editor squeezed to
 * its range, in columns that fill the pane with no space between editors.
 * Until you move something, the map picks the columns: zoom out and more
 * columns fit. Drag a title to drop an editor into a column or between two
 * as a new one; drag a divider to resize. A click raises an editor over the
 * map with the whole file and the language server; Esc puts it back.
 */
import "./canvas.css";

import type { CanvasCardRecord, EnvironmentId, ThreadCanvasState } from "@t3tools/contracts";
import { FootprintsIcon, LayoutDashboardIcon, MinusIcon, PlusIcon, ScanIcon } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useTheme } from "~/hooks/useTheme";
import { cn } from "~/lib/utils";

import { LANE_STYLES } from "./laneStyles";
import { readServerFile } from "./lsp";
import {
  applyDrop,
  autoColumns,
  dropAt,
  layoutColumns,
  type MapDrop,
  type MapItem,
  type MapLayout,
} from "./mapLayout";
import { CODE_LINE_HEIGHT, DARK_THEME, LIGHT_THEME, modelFor, monaco } from "./monaco";
import { useProjectPath } from "./projectPath";
import { LspChip, type SideStep, setSideStepHandler, StepEditor } from "./TraceView";

/** The narrowest column the map picks for itself. */
const AUTO_COLUMN_WIDTH = 560;
const MIN_COLUMN_WIDTH = 220;
const MIN_LINES = 2;
const HEADER_HEIGHT = 34;
const CAPTION_HEIGHT = 30;
const EDITOR_PAD = 6;
/** The tile's border, top and bottom. */
const TILE_BORDER = 2;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;
const ZOOM_KEY = "draw-out:map-zoom";
/** How close, in screen pixels, the pointer must come to a column's side to open a new column. */
const NEW_COLUMN_REACH = 56;

interface MapPrefs {
  /** The user's columns; null while the map picks them. */
  readonly columns: readonly (readonly string[])[] | null;
  readonly weights: readonly number[];
  /** Editor heights the user set, before stretching. */
  readonly heights: Readonly<Record<string, number>>;
}

const AUTO: MapPrefs = { columns: null, weights: [], heights: {} };

const prefsKey = (threadId: string) => `draw-out:map:${threadId}`;

function readPrefs(threadId: string): MapPrefs {
  try {
    const value = JSON.parse(localStorage.getItem(prefsKey(threadId)) ?? "null");
    if (value && "columns" in value && typeof value.heights === "object") return value as MapPrefs;
  } catch {
    // A bad entry starts the map fresh.
  }
  return AUTO;
}

const rangeLines = (card: CanvasCardRecord) => card.endLine - card.startLine + 1;

const clampZoom = (zoom: number) =>
  Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 100) / 100));

function headerHeight(card: CanvasCardRecord): number {
  return HEADER_HEIGHT + (card.caption ? CAPTION_HEIGHT : 0);
}

const chromeHeight = (card: CanvasCardRecord) => headerHeight(card) + 2 * EDITOR_PAD + TILE_BORDER;

/** The code lines a tile of `height` shows. */
const linesIn = (card: CanvasCardRecord, height: number) =>
  Math.max(1, Math.floor((height - chromeHeight(card)) / CODE_LINE_HEIGHT));

const loading = new Map<string, Promise<monaco.editor.ITextModel | null>>();

/** The file's shared model, read once from the server. */
function loadModel(
  environmentId: EnvironmentId,
  path: string,
): Promise<monaco.editor.ITextModel | null> {
  const existing = monaco.editor.getModel(monaco.Uri.file(path));
  if (existing) return Promise.resolve(existing);
  const key = `${environmentId}:${path}`;
  let pending = loading.get(key);
  if (!pending) {
    pending = readServerFile(environmentId, path).then((contents) => {
      loading.delete(key);
      return contents === null ? null : modelFor(path, contents);
    });
    loading.set(key, pending);
  }
  return pending;
}

interface Drag {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly drop: MapDrop;
}

export function MapView(props: {
  readonly environmentId: EnvironmentId;
  readonly canvas: ThreadCanvasState;
  readonly onSteps: (cardId: string | null) => void;
}) {
  const { environmentId, canvas, onSteps } = props;
  const threadId = canvas.threadId;
  const projectPath = useProjectPath();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [prefs, setPrefs] = useState<MapPrefs>(() => readPrefs(threadId));
  const [zoom, setZoom] = useState(() => clampZoom(Number(localStorage.getItem(ZOOM_KEY)) || 1));
  const [view, setView] = useState({ width: 800, height: 600 });
  const [selected, setSelected] = useState<string | null>(null);
  const [raised, setRaised] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [resizing, setResizing] = useState(false);

  useEffect(
    () => localStorage.setItem(prefsKey(threadId), JSON.stringify(prefs)),
    [prefs, threadId],
  );
  useEffect(() => localStorage.setItem(ZOOM_KEY, String(zoom)), [zoom]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const observer = new ResizeObserver(() =>
      setView({ width: scroller.clientWidth, height: scroller.clientHeight }),
    );
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  const cardsById = useMemo(
    () => new Map(canvas.cards.map((card) => [card.id, card])),
    [canvas.cards],
  );
  const heights = useMemo(
    () =>
      new Map(
        canvas.cards.map((card) => [
          card.id,
          prefs.heights[card.id] ?? chromeHeight(card) + rangeLines(card) * CODE_LINE_HEIGHT,
        ]),
      ),
    [canvas.cards, prefs.heights],
  );

  const layoutAt = useCallback(
    (scale: number): MapLayout => {
      const width = view.width / scale;
      const items: MapItem[] = canvas.cards.map((card) => ({
        id: card.id,
        height: heights.get(card.id) ?? 0,
      }));
      let columns: string[][] | null = null;
      if (prefs.columns) {
        // The user's columns, without cards that are gone; new cards join the shortest column.
        columns = prefs.columns
          .map((column) => column.filter((id) => cardsById.has(id)))
          .filter((column) => column.length > 0);
        const placed = new Set(columns.flat());
        for (const item of items) {
          if (placed.has(item.id) || columns.length === 0) continue;
          const totals = columns.map((column) =>
            column.reduce((total, id) => total + (heights.get(id) ?? 0), 0),
          );
          columns[totals.indexOf(Math.min(...totals))]!.push(item.id);
        }
        if (columns.length === 0) columns = null;
      }
      columns ??= autoColumns(items, Math.max(1, Math.floor(width / AUTO_COLUMN_WIDTH)));
      return layoutColumns(columns, heights, prefs.columns ? prefs.weights : [], width);
    },
    [canvas.cards, cardsById, heights, prefs.columns, prefs.weights, view.width],
  );
  const layout = useMemo(() => layoutAt(zoom), [layoutAt, zoom]);
  const order = useMemo(() => layout.columns.flat(), [layout.columns]);

  // Pointer handlers read the latest values through refs.
  const latest = useRef({ layout, zoom, prefs });
  latest.current = { layout, zoom, prefs };

  const contentPoint = (clientX: number, clientY: number) => {
    const rect = contentRef.current!.getBoundingClientRect();
    const scale = latest.current.zoom;
    return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale };
  };

  const track = (
    event: React.PointerEvent,
    onMove: (dx: number, dy: number, moveEvent: PointerEvent) => void,
    onEnd: (moved: boolean) => void,
    cursor: string,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    rootRef.current?.focus({ preventScroll: true });
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    let frame = 0;
    let last: PointerEvent | null = null;
    const move = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      if (!moved) document.body.style.cursor = cursor;
      moved = true;
      last = moveEvent;
      // One update per frame, however fast the pointer moves.
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        if (last) onMove(last.clientX - startX, last.clientY - startY, last);
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      cancelAnimationFrame(frame);
      document.body.style.removeProperty("cursor");
      onEnd(moved);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const raise = useCallback((id: string) => {
    setSelected(id);
    setRaised(id);
  }, []);

  /** Drag the background or an editor's code to pan; a click without a drag runs `onClick`. */
  const startPan = (event: React.PointerEvent, onClick: () => void) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const left = scroller.scrollLeft;
    const top = scroller.scrollTop;
    track(
      event,
      (dx, dy) => {
        scroller.scrollLeft = left - dx;
        scroller.scrollTop = top - dy;
      },
      (moved) => {
        if (!moved) onClick();
      },
      "grabbing",
    );
  };

  /** The user's columns from now on: the ones on screen. */
  const fixColumns = (current: MapPrefs, shown: MapLayout): MapPrefs =>
    current.columns
      ? current
      : { ...current, columns: shown.columns, weights: shown.columns.map(() => 1) };

  const startMove = (event: React.PointerEvent, id: string) => {
    const rect = layout.rects.get(id);
    if (!rect) return;
    const start = contentPoint(event.clientX, event.clientY);
    const offset = { x: start.x - rect.x, y: start.y - rect.y };
    let current: Drag | null = null;
    track(
      event,
      (_dx, _dy, moveEvent) => {
        const { layout: shown, zoom: scale } = latest.current;
        const point = contentPoint(moveEvent.clientX, moveEvent.clientY);
        current = {
          id,
          x: point.x - offset.x,
          y: point.y - offset.y,
          drop: dropAt(shown, id, point.x, point.y, NEW_COLUMN_REACH / scale),
        };
        setDrag(current);
      },
      (moved) => {
        setDrag(null);
        if (!moved) {
          raise(id);
          return;
        }
        const landed = current;
        if (!landed) return;
        const shown = latest.current.layout;
        setPrefs((previous) => {
          const fixed = fixColumns(previous, shown);
          return { ...fixed, ...applyDrop(shown.columns, fixed.weights, id, landed.drop) };
        });
      },
      "grabbing",
    );
  };

  /** Drag the line between two columns. */
  const startColumnResize = (event: React.PointerEvent, index: number) => {
    const shown = layout;
    const widths = shown.columnRects.map((column) => column.width);
    setResizing(true);
    track(
      event,
      (dx) => {
        const delta = dx / latest.current.zoom;
        const left = widths[index]!;
        const right = widths[index + 1]!;
        const moved = Math.max(MIN_COLUMN_WIDTH - left, Math.min(right - MIN_COLUMN_WIDTH, delta));
        const next = widths.map((width, other) =>
          other === index ? left + moved : other === index + 1 ? right - moved : width,
        );
        setPrefs((previous) => ({ ...fixColumns(previous, shown), weights: next }));
      },
      () => setResizing(false),
      "col-resize",
    );
  };

  /** Drag the line between two editors in a column. */
  const startEditorResize = (event: React.PointerEvent, above: string, below: string) => {
    const shown = layout;
    const top = shown.rects.get(above);
    const bottom = shown.rects.get(below);
    const topCard = cardsById.get(above);
    const bottomCard = cardsById.get(below);
    const column = shown.columns.find((ids) => ids.includes(above));
    if (!top || !bottom || !topCard || !bottomCard || !column) return;
    // Heights stretch by the column's scale; undo it to store the editors' own heights.
    const natural = column.reduce((total, id) => total + (heights.get(id) ?? 0), 0);
    const scale = natural > 0 ? shown.height / natural : 1;
    const minTop = chromeHeight(topCard) + MIN_LINES * CODE_LINE_HEIGHT;
    const minBottom = chromeHeight(bottomCard) + MIN_LINES * CODE_LINE_HEIGHT;
    setResizing(true);
    track(
      event,
      (_dx, dy) => {
        const delta = dy / latest.current.zoom;
        const moved = Math.max(minTop - top.height, Math.min(bottom.height - minBottom, delta));
        setPrefs((previous) => ({
          ...fixColumns(previous, shown),
          heights: {
            ...previous.heights,
            [above]: (top.height + moved) / scale,
            [below]: (bottom.height - moved) / scale,
          },
        }));
      },
      () => setResizing(false),
      "row-resize",
    );
  };

  // Zoom keeps the map's top-left corner where it is on screen.
  const anchorRef = useRef<{ x: number; y: number } | null>(null);
  const zoomTo = useCallback((next: number) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const scale = latest.current.zoom;
    anchorRef.current = { x: scroller.scrollLeft / scale, y: scroller.scrollTop / scale };
    setZoom(clampZoom(next));
  }, []);
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const scroller = scrollerRef.current;
    if (!anchor || !scroller) return;
    anchorRef.current = null;
    scroller.scrollLeft = anchor.x * zoom;
    scroller.scrollTop = anchor.y * zoom;
  }, [zoom]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      zoomTo(latest.current.zoom * Math.exp(-event.deltaY * 0.004));
    };
    scroller.addEventListener("wheel", onWheel, { passive: false });
    return () => scroller.removeEventListener("wheel", onWheel);
  }, [zoomTo]);

  /** The largest zoom, up to 100%, that shows the whole map. */
  const fit = () => {
    let next = 1;
    while (next > MIN_ZOOM && layoutAt(next).height * next > view.height + 1) {
      next = Math.round((next - 0.05) * 100) / 100;
    }
    zoomTo(next);
    scrollerRef.current?.scrollTo({ left: 0, top: 0 });
  };

  // Keep the selected editor in view.
  useEffect(() => {
    const rect = selected ? latest.current.layout.rects.get(selected) : null;
    const scroller = scrollerRef.current;
    if (!rect || !scroller) return;
    const scale = latest.current.zoom;
    const top = rect.y * scale;
    const bottom = top + rect.height * scale;
    if (top < scroller.scrollTop || bottom > scroller.scrollTop + scroller.clientHeight) {
      scroller.scrollTo({ top, behavior: "smooth" });
    }
  }, [selected]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (raised || event.metaKey || event.ctrlKey || event.altKey) return;
    const index = selected ? order.indexOf(selected) : -1;
    const steps: Record<string, number> = {
      ArrowRight: 1,
      ArrowDown: 1,
      ArrowLeft: -1,
      ArrowUp: -1,
    };
    const step = steps[event.key];
    if (step) {
      event.preventDefault();
      const next = index < 0 ? 0 : Math.min(order.length - 1, Math.max(0, index + step));
      setSelected(order[next] ?? null);
    } else if (event.key === "Enter" && selected) {
      event.preventDefault();
      raise(selected);
    } else if (event.key === "Escape") {
      setSelected(null);
    } else if (event.key === "+" || event.key === "=") {
      zoomTo(zoom * 1.25);
    } else if (event.key === "-") {
      zoomTo(zoom / 1.25);
    } else if (event.key === "0") {
      zoomTo(1);
    }
  };

  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  const raisedCard = raised ? (cardsById.get(raised) ?? null) : null;
  const marker = drag ? dropMarker(layout, drag) : null;

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="relative flex h-full min-h-0 flex-col bg-background outline-none"
    >
      <div className="flex items-center gap-2 border-b border-border/60 py-2 pr-28 pl-4 text-xs">
        <div className="flex items-center rounded-md border border-border/70 p-0.5">
          <ToolButton label="Zoom out (-)" onClick={() => zoomTo(zoom / 1.25)}>
            <MinusIcon className="size-3.5" />
          </ToolButton>
          <button
            type="button"
            title="Actual size (0)"
            onClick={() => zoomTo(1)}
            className="w-11 text-center text-muted-foreground tabular-nums hover:text-foreground"
          >
            {Math.round(zoom * 100)}%
          </button>
          <ToolButton label="Zoom in (+)" onClick={() => zoomTo(zoom * 1.25)}>
            <PlusIcon className="size-3.5" />
          </ToolButton>
          <ToolButton label="Fit the whole map" onClick={fit}>
            <ScanIcon className="size-3.5" />
          </ToolButton>
        </div>
        <button
          type="button"
          onClick={() => setPrefs(AUTO)}
          title="Let the map pick the columns again"
          className={cn(
            "flex items-center gap-1.5 rounded-md border px-2 py-1",
            prefs.columns
              ? "border-border/70 text-muted-foreground hover:text-foreground"
              : "border-primary/50 bg-primary/10 text-foreground",
          )}
        >
          <LayoutDashboardIcon className="size-3.5" />
          {prefs.columns ? "Auto layout" : "Auto layout on"}
        </button>
        <ToolButton label="Step view" onClick={() => onSteps(selected)}>
          <FootprintsIcon className="size-3.5" />
        </ToolButton>
        <span className="ml-auto hidden truncate text-2xs text-muted-foreground xl:inline">
          Drag a title to move · drag a line between editors to resize · click to open · Cmd-scroll
          to zoom
        </span>
      </div>
      {canvas.cards.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          <div className="max-w-sm text-center">
            <p className="font-medium text-foreground">No trace yet</p>
            <p className="mt-1">Ask how a feature works. The code the agent finds shows here.</p>
          </div>
        </div>
      ) : null}
      <div
        ref={scrollerRef}
        onPointerDown={(event) => startPan(event, () => setSelected(null))}
        className="relative min-h-0 flex-1 cursor-grab overflow-auto"
      >
        <div style={{ width: layout.width * zoom, height: layout.height * zoom }}>
          <div
            ref={contentRef}
            className="relative origin-top-left"
            style={{
              width: layout.width,
              height: layout.height,
              transform: `scale(${zoom})`,
            }}
          >
            {order.map((id) => {
              const card = cardsById.get(id);
              const rect = layout.rects.get(id);
              if (!card || !rect) return null;
              const dragged = drag !== null && drag.id === id;
              return (
                <MapTile
                  key={id}
                  environmentId={environmentId}
                  card={card}
                  path={projectPath(card.path)}
                  lines={linesIn(card, rect.height)}
                  x={drag && dragged ? drag.x : rect.x}
                  y={drag && dragged ? drag.y : rect.y}
                  width={rect.width}
                  height={rect.height}
                  dragged={dragged}
                  still={dragged || resizing}
                  selected={selected === id}
                  onMoveStart={(event) => startMove(event, id)}
                  onBodyDown={(event) => startPan(event, () => raise(id))}
                />
              );
            })}
            {layout.columnRects.slice(1).map((column, index) => (
              <div
                key={`column-${column.x}`}
                onPointerDown={(event) => startColumnResize(event, index)}
                className="drawout-map-divider absolute top-0 z-10 w-2 -translate-x-1/2 cursor-col-resize"
                style={{ left: column.x, height: layout.height }}
              />
            ))}
            {layout.columns.flatMap((column) =>
              column.slice(1).map((below, index) => {
                const above = column[index]!;
                const rect = layout.rects.get(below);
                if (!rect) return null;
                return (
                  <div
                    key={`row-${below}`}
                    onPointerDown={(event) => startEditorResize(event, above, below)}
                    className="drawout-map-divider absolute z-10 h-2 -translate-y-1/2 cursor-row-resize"
                    style={{ left: rect.x, top: rect.y, width: rect.width }}
                  />
                );
              }),
            )}
            {marker ? (
              <div
                className="pointer-events-none absolute z-40 rounded-full bg-primary shadow-[0_0_0_3px] shadow-primary/30"
                style={marker}
              />
            ) : null}
          </div>
        </div>
      </div>
      {raisedCard ? (
        <RaisedEditor
          environmentId={environmentId}
          card={raisedCard}
          projectPath={projectPath}
          onClose={() => {
            setRaised(null);
            rootRef.current?.focus({ preventScroll: true });
          }}
          onSteps={() => onSteps(raisedCard.id)}
        />
      ) : null}
    </div>
  );
}

/** The bar that shows where a dragged editor lands. */
function dropMarker(layout: MapLayout, drag: Drag): React.CSSProperties | null {
  const { drop } = drag;
  const bar = 4;
  if (drop.kind === "column") {
    const x = layout.columnRects[drop.index]?.x ?? layout.width;
    return {
      left: Math.min(Math.max(0, x - bar / 2), layout.width - bar),
      top: 0,
      width: bar,
      height: layout.height,
    };
  }
  const column = layout.columnRects[drop.column];
  if (!column) return null;
  const others = (layout.columns[drop.column] ?? []).filter((id) => id !== drag.id);
  const next = others[drop.index];
  const previous = others[drop.index - 1];
  const y = next
    ? (layout.rects.get(next)?.y ?? 0)
    : previous
      ? (() => {
          const rect = layout.rects.get(previous);
          return rect ? rect.y + rect.height : 0;
        })()
      : 0;
  return {
    left: column.x + 8,
    top: Math.min(Math.max(0, y - bar / 2), layout.height - bar),
    width: column.width - 16,
    height: bar,
  };
}

function MapTile(props: {
  readonly environmentId: EnvironmentId;
  readonly card: CanvasCardRecord;
  readonly path: string;
  readonly lines: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly dragged: boolean;
  readonly still: boolean;
  readonly selected: boolean;
  readonly onMoveStart: (event: React.PointerEvent) => void;
  readonly onBodyDown: (event: React.PointerEvent) => void;
}) {
  const { card, dragged, selected } = props;
  const lane = LANE_STYLES[card.lane];
  return (
    <div
      className={cn(
        "drawout-map-tile absolute top-0 left-0 flex flex-col overflow-hidden border",
        dragged && "pointer-events-none z-30 opacity-90 shadow-2xl",
        selected && "drawout-map-tile-selected z-10",
        !props.still && "transition-[transform,width,height] duration-200 ease-out",
      )}
      style={
        {
          width: props.width,
          height: props.height,
          transform: `translate(${props.x}px, ${props.y}px)`,
          "--lane": lane.color,
        } as React.CSSProperties
      }
    >
      <div
        onPointerDown={props.onMoveStart}
        className="drawout-map-tile-header shrink-0 cursor-grab px-3 active:cursor-grabbing"
        style={{ height: headerHeight(card) }}
      >
        <div className="flex h-[34px] items-center gap-2">
          <span className="drawout-map-tile-lane shrink-0 text-2xs font-semibold uppercase">
            {lane.label}
          </span>
          <span className="shrink-0 truncate text-sm font-semibold">
            {card.title ?? card.path.split("/").pop()}
          </span>
          <span
            className="min-w-0 flex-1 truncate font-mono text-2xs text-muted-foreground"
            style={{ direction: "rtl", textAlign: "left" }}
          >
            <bdi>{`${props.path}:${card.startLine}–${card.endLine}`}</bdi>
          </span>
        </div>
        {card.caption ? (
          <p className="-mt-1 line-clamp-1 text-xs leading-4.5 text-muted-foreground">
            {card.caption}
          </p>
        ) : null}
      </div>
      <div className="relative min-h-0 flex-1">
        <TileEditor environmentId={props.environmentId} card={card} lines={props.lines} />
        <div
          onPointerDown={props.onBodyDown}
          className="absolute inset-0 cursor-pointer hover:bg-primary/[0.03]"
          title="Click to open the whole file"
        />
      </div>
    </div>
  );
}

/** An editor on the card's file, cut to `lines` lines around its range. */
function TileEditor(props: {
  readonly environmentId: EnvironmentId;
  readonly card: CanvasCardRecord;
  readonly lines: number;
}) {
  const { environmentId, card, lines } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const { resolvedTheme } = useTheme();
  const [model, setModel] = useState<monaco.editor.ITextModel | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const editor = monaco.editor.create(host, {
      theme: resolvedTheme === "dark" ? DARK_THEME : LIGHT_THEME,
      readOnly: true,
      domReadOnly: true,
      automaticLayout: true,
      fontFamily:
        getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim() ||
        "monospace",
      fontSize: 13,
      lineHeight: CODE_LINE_HEIGHT,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      stickyScroll: { enabled: false },
      padding: { top: 0, bottom: 0 },
      renderLineHighlight: "none",
      lineNumbersMinChars: 3,
      glyphMargin: false,
      folding: false,
      overviewRulerLanes: 0,
      overviewRulerBorder: false,
      hideCursorInOverviewRuler: true,
      scrollbar: {
        vertical: "hidden",
        horizontal: "hidden",
        handleMouseWheel: false,
        alwaysConsumeMouseWheel: false,
      },
      contextmenu: false,
      hover: { enabled: "off" },
      occurrencesHighlight: "off",
      selectionHighlight: false,
      matchBrackets: "never",
      links: false,
    });
    editorRef.current = editor;
    return () => {
      editor.dispose();
      editorRef.current = null;
    };
    // One editor per tile; the model and range change below.
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadModel(environmentId, card.path).then((loaded) => {
      if (cancelled) return;
      setError(loaded === null);
      setModel(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [card.path, environmentId]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !model) return;
    if (editor.getModel() !== model) editor.setModel(model);
    const decorations = editor.createDecorationsCollection([
      {
        range: new monaco.Range(card.startLine, 1, card.endLine, 1),
        options: {
          isWholeLine: true,
          className: "drawout-step-range",
          linesDecorationsClassName: "drawout-range-gutter",
        },
      },
    ]);
    const extra = Math.max(0, lines - rangeLines(card));
    const firstLine = Math.max(1, card.startLine - Math.floor(extra / 2));
    editor.setScrollTop(editor.getTopForLineNumber(firstLine));
    return () => decorations.clear();
  }, [card, lines, model]);

  return (
    <>
      <div
        ref={hostRef}
        className="drawout-step-editor absolute inset-x-0"
        style={{ top: EDITOR_PAD, bottom: EDITOR_PAD }}
      />
      {error ? (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
          Could not read {card.path}
        </div>
      ) : null}
    </>
  );
}

/** The editor raised over the map: the whole file, with the language server. */
function RaisedEditor(props: {
  readonly environmentId: EnvironmentId;
  readonly card: CanvasCardRecord;
  readonly projectPath: (path: string) => string;
  readonly onClose: () => void;
  readonly onSteps: () => void;
}) {
  const { environmentId, card, onClose } = props;
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [sideSteps, setSideSteps] = useState<SideStep[]>([]);
  const sideStep = sideSteps.at(-1) ?? null;
  const lane = LANE_STYLES[card.lane];

  useEffect(() => setSideStepHandler((step) => setSideSteps((steps) => [...steps, step])), []);
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  const onKeyDownCapture = (event: React.KeyboardEvent) => {
    if (event.key !== "Escape") return;
    const widgetOpen = panelRef.current?.querySelector(
      ".monaco-hover:not(.hidden), .peekview-widget, .find-widget.visible, .suggest-widget.visible",
    );
    if (widgetOpen) return;
    event.preventDefault();
    event.stopPropagation();
    if (sideSteps.length > 0) setSideSteps((steps) => steps.slice(0, -1));
    else onClose();
  };

  return (
    <div
      className="drawout-raise-backdrop absolute inset-0 z-30 bg-background/60 backdrop-blur-[2px]"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        onKeyDownCapture={onKeyDownCapture}
        className="drawout-raise absolute inset-3 flex flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl outline-none md:inset-6"
      >
        <div className="flex items-start gap-3 border-b border-border/60 px-5 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-3">
              <span
                className="size-2 shrink-0 self-center rounded-full"
                style={{ background: lane.color }}
              />
              <h2 className="truncate text-base font-semibold">
                {sideStep
                  ? sideStep.path.split("/").pop()
                  : (card.title ?? card.path.split("/").pop())}
              </h2>
              <span
                className="truncate font-mono text-xs text-muted-foreground"
                style={{ direction: "rtl", textAlign: "left" }}
              >
                <bdi>
                  {sideStep
                    ? `${props.projectPath(sideStep.path)}:${sideStep.line}`
                    : `${props.projectPath(card.path)}:${card.startLine}–${card.endLine}`}
                </bdi>
              </span>
            </div>
            {sideStep ? (
              <p className="mt-1 text-sm text-muted-foreground">
                Your side step from {card.title ?? card.id}. Esc goes back.
              </p>
            ) : card.caption ? (
              <p className="mt-1.5 text-sm leading-5">{card.caption}</p>
            ) : null}
          </div>
        </div>
        <StepEditor environmentId={environmentId} card={card} sideStep={sideStep} />
        <div className="flex items-center gap-3 border-t border-border/60 px-5 py-2 text-2xs text-muted-foreground">
          <LspChip environmentId={environmentId} path={sideStep?.path ?? card.path} />
          <span className="flex-1">Cmd-click a name to follow it · Esc back to the map</span>
          <button type="button" onClick={props.onSteps} className="hover:text-foreground">
            Step view
          </button>
          <button type="button" onClick={onClose} className="hover:text-foreground">
            Close (Esc)
          </button>
        </div>
      </div>
    </div>
  );
}

function ToolButton(props: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {props.children}
    </button>
  );
}
