/**
 * Draw-out: the map of a thread's trace. Each card is an editor squeezed to
 * its range, packed on a map you scroll, drag and zoom. Drag a title to move
 * an editor and its edges to resize it; the others make room. A click raises
 * an editor over the map with the whole file and the language server; Esc
 * puts it back.
 */
import "./canvas.css";

import type { CanvasCardRecord, EnvironmentId, ThreadCanvasState } from "@t3tools/contracts";
import { FootprintsIcon, MinusIcon, PlusIcon, RotateCcwIcon, ScanIcon } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useTheme } from "~/hooks/useTheme";
import { cn } from "~/lib/utils";

import { LANE_STYLES } from "./laneStyles";
import { readServerFile } from "./lsp";
import { layoutMap, type MapItem, type MapLayoutKind, moveInOrder } from "./mapLayout";
import { CODE_LINE_HEIGHT, DARK_THEME, LIGHT_THEME, modelFor, monaco } from "./monaco";
import { useProjectPath } from "./projectPath";
import { LspChip, type SideStep, setSideStepHandler, StepEditor } from "./TraceView";

const DEFAULT_WIDTH = 640;
const MIN_WIDTH = 280;
const MIN_LINES = 3;
const HEADER_HEIGHT = 34;
const CAPTION_HEIGHT = 30;
const EDITOR_PAD = 6;
/** The tile's border, top and bottom. */
const TILE_BORDER = 2;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;
const LAYOUT_KEY = "draw-out:map-layout";
const ZOOM_KEY = "draw-out:map-zoom";
const LAYOUTS: readonly { readonly kind: MapLayoutKind; readonly label: string }[] = [
  { kind: "pack", label: "Pack" },
  { kind: "rows", label: "Rows" },
  { kind: "files", label: "Files" },
];

interface MapPrefs {
  readonly order: readonly string[];
  readonly sizes: Readonly<Record<string, { readonly width?: number; readonly lines?: number }>>;
}

const prefsKey = (threadId: string) => `draw-out:map:${threadId}`;

function readPrefs(threadId: string): MapPrefs {
  try {
    const value = JSON.parse(localStorage.getItem(prefsKey(threadId)) ?? "null");
    if (value && Array.isArray(value.order)) return value as MapPrefs;
  } catch {
    // A bad entry starts the map fresh.
  }
  return { order: [], sizes: {} };
}

const rangeLines = (card: CanvasCardRecord) => card.endLine - card.startLine + 1;

const clampZoom = (zoom: number) =>
  Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 100) / 100));

function headerHeight(card: CanvasCardRecord): number {
  return HEADER_HEIGHT + (card.caption ? CAPTION_HEIGHT : 0);
}

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

type Drag = { readonly id: string; readonly x: number; readonly y: number };

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
  const [kind, setKind] = useState<MapLayoutKind>(
    () => (localStorage.getItem(LAYOUT_KEY) as MapLayoutKind | null) ?? "pack",
  );
  const [zoom, setZoom] = useState(() => clampZoom(Number(localStorage.getItem(ZOOM_KEY)) || 1));
  const [view, setView] = useState({ width: 800, height: 600 });
  const [selected, setSelected] = useState<string | null>(null);
  const [raised, setRaised] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [resizing, setResizing] = useState<string | null>(null);

  useEffect(
    () => localStorage.setItem(prefsKey(threadId), JSON.stringify(prefs)),
    [prefs, threadId],
  );
  useEffect(() => localStorage.setItem(LAYOUT_KEY, kind), [kind]);
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
  // The user's order first; cards the agent adds later go at the end.
  const order = useMemo(() => {
    const known = prefs.order.filter((id) => cardsById.has(id));
    return [...known, ...canvas.cards.map((card) => card.id).filter((id) => !known.includes(id))];
  }, [canvas.cards, cardsById, prefs.order]);

  const linesOf = useCallback(
    (card: CanvasCardRecord) => prefs.sizes[card.id]?.lines ?? rangeLines(card),
    [prefs.sizes],
  );
  const items = useMemo<MapItem[]>(
    () =>
      order.flatMap((id) => {
        const card = cardsById.get(id);
        if (!card) return [];
        return [
          {
            id,
            path: card.path,
            startLine: card.startLine,
            width: prefs.sizes[id]?.width ?? DEFAULT_WIDTH,
            height:
              headerHeight(card) + linesOf(card) * CODE_LINE_HEIGHT + 2 * EDITOR_PAD + TILE_BORDER,
          },
        ];
      }),
    [cardsById, linesOf, order, prefs.sizes],
  );
  const layout = useMemo(
    () => layoutMap(items, kind, view.width / zoom),
    [items, kind, view.width, zoom],
  );

  // Pointer handlers read the latest values through refs.
  const latest = useRef({ layout, order, zoom, prefs });
  latest.current = { layout, order, zoom, prefs };

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
    const move = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      if (!moved) document.body.style.cursor = cursor;
      moved = true;
      onMove(dx, dy, moveEvent);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
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

  const startMove = (event: React.PointerEvent, id: string) => {
    const rect = layout.rects.get(id);
    if (!rect) return;
    const start = contentPoint(event.clientX, event.clientY);
    const offset = { x: start.x - rect.x, y: start.y - rect.y };
    let lastTarget: string | null = null;
    track(
      event,
      (_dx, _dy, moveEvent) => {
        const point = contentPoint(moveEvent.clientX, moveEvent.clientY);
        setDrag({ id, x: point.x - offset.x, y: point.y - offset.y });
        let target: string | null = null;
        for (const [otherId, other] of latest.current.layout.rects) {
          if (otherId === id) continue;
          if (
            point.x >= other.x &&
            point.x <= other.x + other.width &&
            point.y >= other.y &&
            point.y <= other.y + other.height
          ) {
            target = otherId;
          }
        }
        if (target && target !== lastTarget) {
          const next = moveInOrder(latest.current.order, id, target);
          setPrefs((current) => ({ ...current, order: next }));
        }
        lastTarget = target;
      },
      (moved) => {
        setDrag(null);
        if (!moved) raise(id);
      },
      "grabbing",
    );
  };

  const startResize = (
    event: React.PointerEvent,
    card: CanvasCardRecord,
    axes: "x" | "y" | "xy",
  ) => {
    const startWidth = prefs.sizes[card.id]?.width ?? DEFAULT_WIDTH;
    const startLines = linesOf(card);
    setResizing(card.id);
    track(
      event,
      (dx, dy) => {
        const scale = latest.current.zoom;
        setPrefs((current) => ({
          ...current,
          sizes: {
            ...current.sizes,
            [card.id]: {
              ...current.sizes[card.id],
              ...(axes !== "y"
                ? { width: Math.max(MIN_WIDTH, Math.round(startWidth + dx / scale)) }
                : {}),
              ...(axes !== "x"
                ? {
                    lines: Math.max(
                      MIN_LINES,
                      Math.round(startLines + dy / scale / CODE_LINE_HEIGHT),
                    ),
                  }
                : {}),
            },
          },
        }));
      },
      () => setResizing(null),
      axes === "x" ? "ew-resize" : axes === "y" ? "ns-resize" : "nwse-resize",
    );
  };

  // Zoom keeps the point under the pointer (or the view's centre) in place.
  const anchorRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const zoomTo = useCallback((next: number, at?: { clientX: number; clientY: number }) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const box = scroller.getBoundingClientRect();
    const px = at ? at.clientX - box.left : scroller.clientWidth / 2;
    const py = at ? at.clientY - box.top : scroller.clientHeight / 2;
    const scale = latest.current.zoom;
    anchorRef.current = {
      x: (scroller.scrollLeft + px) / scale,
      y: (scroller.scrollTop + py) / scale,
      px,
      py,
    };
    setZoom(clampZoom(next));
  }, []);
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const scroller = scrollerRef.current;
    if (!anchor || !scroller) return;
    anchorRef.current = null;
    scroller.scrollLeft = anchor.x * zoom - anchor.px;
    scroller.scrollTop = anchor.y * zoom - anchor.py;
  }, [zoom]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      zoomTo(latest.current.zoom * Math.exp(-event.deltaY * 0.004), event);
    };
    scroller.addEventListener("wheel", onWheel, { passive: false });
    return () => scroller.removeEventListener("wheel", onWheel);
  }, [zoomTo]);

  /** The largest zoom, up to 100%, that shows the whole map. */
  const fit = () => {
    let next = 1;
    while (next > MIN_ZOOM) {
      const fitted = layoutMap(items, kind, view.width / next);
      if (fitted.width * next <= view.width + 1 && fitted.height * next <= view.height + 1) break;
      next = Math.round((next - 0.05) * 100) / 100;
    }
    zoomTo(next);
    scrollerRef.current?.scrollTo({ left: 0, top: 0 });
  };

  // Keep the selected editor in view.
  useEffect(() => {
    const rect = selected ? layout.rects.get(selected) : null;
    const scroller = scrollerRef.current;
    if (!rect || !scroller) return;
    const left = rect.x * zoom;
    const top = rect.y * zoom;
    const right = left + rect.width * zoom;
    const bottom = top + rect.height * zoom;
    const margin = 24;
    let scrollLeft = scroller.scrollLeft;
    let scrollTop = scroller.scrollTop;
    if (left < scrollLeft || right > scrollLeft + scroller.clientWidth) scrollLeft = left - margin;
    if (top < scrollTop || bottom > scrollTop + scroller.clientHeight) scrollTop = top - margin;
    scroller.scrollTo({ left: scrollLeft, top: scrollTop, behavior: "smooth" });
    // Only a new selection scrolls, not a reflow.
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

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="relative flex h-full min-h-0 flex-col bg-background outline-none"
    >
      <div className="flex items-center gap-2 border-b border-border/60 py-2 pr-28 pl-4 text-xs">
        <div className="flex rounded-md border border-border/70 p-0.5">
          {LAYOUTS.map((layoutOption) => (
            <button
              key={layoutOption.kind}
              type="button"
              onClick={() => setKind(layoutOption.kind)}
              className={cn(
                "rounded px-2 py-0.5",
                kind === layoutOption.kind
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {layoutOption.label}
            </button>
          ))}
        </div>
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
        <ToolButton
          label="Reset order and sizes"
          onClick={() => setPrefs({ order: [], sizes: {} })}
        >
          <RotateCcwIcon className="size-3.5" />
        </ToolButton>
        <ToolButton label="Step view" onClick={() => onSteps(selected)}>
          <FootprintsIcon className="size-3.5" />
        </ToolButton>
        <span className="ml-auto hidden truncate text-2xs text-muted-foreground xl:inline">
          Drag a title to move · edges to resize · click to open · drag or scroll to pan ·
          Cmd-scroll to zoom
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
                  lines={linesOf(card)}
                  x={drag && dragged ? drag.x : rect.x}
                  y={drag && dragged ? drag.y : rect.y}
                  width={rect.width}
                  height={rect.height}
                  dragged={dragged}
                  still={dragged || resizing === id}
                  selected={selected === id}
                  onMoveStart={(event) => startMove(event, id)}
                  onBodyDown={(event) => startPan(event, () => raise(id))}
                  onResizeStart={(event, axes) => startResize(event, card, axes)}
                />
              );
            })}
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
  readonly onResizeStart: (event: React.PointerEvent, axes: "x" | "y" | "xy") => void;
}) {
  const { card, dragged, selected } = props;
  const lane = LANE_STYLES[card.lane];
  return (
    <div
      className={cn(
        "absolute top-0 left-0 flex flex-col overflow-hidden rounded-lg border bg-card",
        dragged ? "z-20 shadow-2xl ring-1 ring-primary/40" : "shadow-sm",
        selected ? "border-primary/70" : "border-border/70",
        !props.still && "transition-[transform,width,height] duration-200 ease-out",
      )}
      style={{
        width: props.width,
        height: props.height,
        transform: `translate(${props.x}px, ${props.y}px)`,
      }}
    >
      <div
        onPointerDown={props.onMoveStart}
        className="shrink-0 cursor-grab border-b border-border/50 px-3 active:cursor-grabbing"
        style={{ height: headerHeight(card) }}
      >
        <div className="flex h-[34px] items-center gap-2">
          <span className="size-2 shrink-0 rounded-full" style={{ background: lane.color }} />
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
      <div
        onPointerDown={(event) => props.onResizeStart(event, "x")}
        className="absolute top-0 right-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-primary/30"
      />
      <div
        onPointerDown={(event) => props.onResizeStart(event, "y")}
        className="absolute right-0 bottom-0 left-0 h-1.5 cursor-ns-resize hover:bg-primary/30"
      />
      <div
        onPointerDown={(event) => props.onResizeStart(event, "xy")}
        className="absolute right-0 bottom-0 size-3 cursor-nwse-resize hover:bg-primary/40"
      />
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
