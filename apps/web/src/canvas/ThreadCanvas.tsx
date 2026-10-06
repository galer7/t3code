/**
 * Draw-out: the thread's canvas. Cards sit in lanes, left to right; arrows
 * show how the code flows. Drag a card to pin it, Tidy to unpin all.
 */
import "@xyflow/react/dist/style.css";
import "./canvas.css";

import { useAtomValue } from "@effect/atom-react";
import type {
  CanvasEdit,
  CanvasPoint,
  ScopedThreadRef,
  ThreadCanvasState,
} from "@t3tools/contracts";
import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  MarkerType,
  MiniMap,
  type Node,
  type NodeChange,
  type NodeProps,
  ReactFlow,
  type ReactFlowInstance,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import { AsyncResult } from "effect/unstable/reactivity";
import { LayoutGridIcon, ScanIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useTheme } from "~/hooks/useTheme";
import { canvasEnvironment } from "~/state/canvas";
import { useAtomCommand } from "~/state/use-atom-command";

import { CARD_WIDTH, type LaneColumn, layoutCanvas } from "./canvasLayout";
import { type CodeCardNode, CodeCardView } from "./CodeCard";
import { LANE_STYLES } from "./laneStyles";

type LaneNode = Node<{ readonly column: LaneColumn }, "lane">;
type CanvasNode = CodeCardNode | LaneNode;

const LANE_PADDING = 28;

function LaneView({ data }: NodeProps<LaneNode>) {
  const style = LANE_STYLES[data.column.lane];
  return (
    <div
      className="pointer-events-none rounded-3xl border border-dashed border-border/40 bg-muted/[0.04]"
      style={{ width: CARD_WIDTH + LANE_PADDING * 2, height: data.column.height }}
    >
      <div className="flex items-center gap-2 px-7 pt-5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        <span className="size-2 rounded-full" style={{ background: style.color }} />
        {style.label}
      </div>
    </div>
  );
}

const nodeTypes = { code: CodeCardView, lane: LaneView };

export default function ThreadCanvas(props: {
  readonly threadRef: ScopedThreadRef;
  readonly onOpenCard?: (cardId: string) => void;
}) {
  return (
    <ReactFlowProvider>
      <ThreadCanvasFlow threadRef={props.threadRef} onOpenCard={props.onOpenCard} />
    </ReactFlowProvider>
  );
}

function ThreadCanvasFlow({
  threadRef,
  onOpenCard,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly onOpenCard: ((cardId: string) => void) | undefined;
}) {
  const canvasResult = useAtomValue(
    canvasEnvironment.canvas({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    }),
  );
  const canvas: ThreadCanvasState = AsyncResult.isSuccess(canvasResult)
    ? canvasResult.value
    : emptyCanvas(threadRef);
  const runEdit = useAtomCommand(canvasEnvironment.edit, "canvas edit");
  const edit = useCallback(
    (change: CanvasEdit) =>
      void runEdit({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, edit: change },
      }),
    [runEdit, threadRef.environmentId, threadRef.threadId],
  );
  const { resolvedTheme } = useTheme();
  const flow = useReactFlow<CanvasNode>();

  const [heights, setHeights] = useState<Record<string, number>>({});
  const [dragging, setDragging] = useState<Record<string, CanvasPoint>>({});
  const draggingRef = useRef<Record<string, CanvasPoint>>({});
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const settled = Object.keys(draggingRef.current).filter((id) => {
      const pinned = canvas.pinned[id];
      const dropped = draggingRef.current[id];
      return pinned && dropped && pinned.x === dropped.x && pinned.y === dropped.y;
    });
    if (settled.length === 0) return;
    const rest = { ...draggingRef.current };
    for (const id of settled) delete rest[id];
    draggingRef.current = rest;
    setDragging(rest);
  }, [canvas.pinned]);

  const layout = useMemo(() => layoutCanvas(canvas, heights), [canvas, heights]);
  const bounds = useMemo(
    () => cardBounds(canvas, layout.positions, heights),
    [canvas, heights, layout.positions],
  );
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;
  const onRemove = useCallback((cardId: string) => edit({ type: "remove", cardId }), [edit]);

  const nodes = useMemo<CanvasNode[]>(() => {
    const lanes: LaneNode[] = layout.lanes.map((column) => ({
      id: `lane:${column.lane}`,
      type: "lane",
      position: { x: column.x - LANE_PADDING, y: 0 },
      data: { column },
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: -1,
    }));
    const cards: CodeCardNode[] = canvas.cards.map((card) => ({
      id: card.id,
      type: "code",
      position: dragging[card.id] ?? layout.positions[card.id] ?? { x: 0, y: 0 },
      data: { card, environmentId: threadRef.environmentId, onRemove },
      selected: selected.has(card.id),
    }));
    return [...lanes, ...cards];
  }, [canvas.cards, dragging, layout, onRemove, selected, threadRef.environmentId]);

  const edges = useMemo<Edge[]>(
    () =>
      canvas.arrows.flatMap((arrow) => {
        const from = dragging[arrow.from] ?? layout.positions[arrow.from];
        const to = dragging[arrow.to] ?? layout.positions[arrow.to];
        if (!from || !to) return [];
        const sideways = Math.abs(to.x - from.x) > CARD_WIDTH / 2;
        const [sourceHandle, targetHandle] = sideways
          ? to.x > from.x
            ? ["right", "left"]
            : ["left-source", "right-target"]
          : to.y >= from.y
            ? ["bottom", "top"]
            : ["top-source", "bottom-target"];
        return [
          {
            id: arrow.id,
            source: arrow.from,
            target: arrow.to,
            sourceHandle,
            targetHandle,
            type: "default",
            label: arrow.label ?? undefined,
            className: "drawout-arrow",
            markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
            labelBgPadding: [6, 3] as [number, number],
            labelBgBorderRadius: 6,
          },
        ];
      }),
    [canvas.arrows, dragging, layout.positions],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) => {
      for (const change of changes) {
        if (change.type === "dimensions" && change.dimensions && !change.id.startsWith("lane:")) {
          const height = Math.round(change.dimensions.height);
          setHeights((current) =>
            current[change.id] === height ? current : { ...current, [change.id]: height },
          );
        } else if (change.type === "position") {
          const { id, position } = change;
          if (change.dragging && position) {
            draggingRef.current = { ...draggingRef.current, [id]: position };
          } else if (!change.dragging) {
            const dropped = draggingRef.current[id] ?? position;
            if (!dropped) continue;
            // Keep the dropped place until the server's canvas has the pin.
            edit({ type: "pin", cardId: id, x: dropped.x, y: dropped.y });
          }
          setDragging(draggingRef.current);
        } else if (change.type === "select") {
          setSelected((current) => {
            const next = new Set(current);
            if (change.selected) next.add(change.id);
            else next.delete(change.id);
            return next;
          });
        } else if (change.type === "remove") {
          onRemove(change.id);
        }
      }
    },
    [edit, onRemove],
  );

  // Open at a readable view once the first cards have their sizes.
  const cardCount = canvas.cards.length;
  const allMeasured = cardCount > 0 && canvas.cards.every((card) => heights[card.id] !== undefined);
  const shownInitially = useRef(false);
  const previousCount = useRef(0);
  useEffect(() => {
    if (shownInitially.current || !allMeasured) return;
    shownInitially.current = true;
    previousCount.current = cardCount;
    showReadable(flow, boundsRef.current, 0);
  }, [allMeasured, cardCount, flow]);
  // If a card never reports its size, show the canvas with estimated sizes.
  useEffect(() => {
    if (cardCount === 0) return;
    const timer = window.setTimeout(() => {
      if (shownInitially.current) return;
      shownInitially.current = true;
      previousCount.current = cardCount;
      showReadable(flow, boundsRef.current, 0);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [cardCount, flow]);

  // Bring each new card into view, and the whole canvas while it is small.
  useEffect(() => {
    if (!shownInitially.current) return;
    const added = cardCount > previousCount.current;
    previousCount.current = cardCount;
    if (!added) return;
    const newest = canvas.cards[canvas.cards.length - 1];
    const timer = window.setTimeout(() => {
      if (cardCount <= 3 || !newest) {
        showReadable(flow, boundsRef.current, 450);
        return;
      }
      const point = layout.positions[newest.id];
      if (!point) return;
      void flow.setCenter(point.x + CARD_WIDTH / 2, point.y + (heights[newest.id] ?? 300) / 2, {
        duration: 450,
        zoom: Math.max(flow.getZoom(), 0.6),
      });
    }, 60);
    return () => window.clearTimeout(timer);
    // Only a new card moves the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardCount]);

  return (
    <div className="drawout-canvas relative h-full min-h-0 w-full">
      <ReactFlow<CanvasNode>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDoubleClick={(_event, node) => {
          if (node.type === "code") onOpenCard?.(node.id);
        }}
        colorMode={resolvedTheme === "dark" ? "dark" : "light"}
        minZoom={0.08}
        maxZoom={1.6}
        panOnScroll
        zoomOnPinch
        selectionOnDrag={false}
        nodesConnectable={false}
        elementsSelectable
        deleteKeyCode={["Backspace", "Delete"]}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap
          pannable
          zoomable
          position="bottom-right"
          nodeClassName={(node) =>
            node.type === "code"
              ? `drawout-mini-${(node as CodeCardNode).data.card.lane}`
              : "drawout-mini-lane"
          }
          nodeStrokeWidth={0}
          nodeBorderRadius={6}
          className="drawout-minimap"
        />
      </ReactFlow>
      <div className="pointer-events-none absolute bottom-0 left-1/2 flex -translate-x-1/2 items-center gap-1 p-3">
        <ToolbarButton
          label="Fit"
          onClick={() => void flow.fitView({ duration: 400, padding: 0.08, maxZoom: 1 })}
        >
          <ScanIcon className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton label="Tidy" onClick={() => edit({ type: "unpinAll" })}>
          <LayoutGridIcon className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton label="Clear" onClick={() => edit({ type: "clear" })}>
          <Trash2Icon className="size-3.5" />
        </ToolbarButton>
      </div>
      {cardCount === 0 ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="max-w-sm text-center text-sm text-muted-foreground">
            <p className="font-medium text-foreground">The canvas is empty</p>
            <p className="mt-1">
              Ask how a feature works. The agent draws its code here, frontend to backend.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface Bounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function cardBounds(
  canvas: ThreadCanvasState,
  positions: Readonly<Record<string, CanvasPoint>>,
  heights: Readonly<Record<string, number>>,
): Bounds | null {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const card of canvas.cards) {
    const point = positions[card.id];
    if (!point) continue;
    left = Math.min(left, point.x);
    top = Math.min(top, point.y);
    right = Math.max(right, point.x + CARD_WIDTH);
    bottom = Math.max(bottom, point.y + (heights[card.id] ?? 300));
  }
  return left === Infinity ? null : { x: left, y: top, width: right - left, height: bottom - top };
}

/** The smallest zoom at which code on a card is still readable. */
const READABLE_ZOOM = 0.62;

/**
 * Fit every card when that keeps the code readable. Otherwise show the top
 * left of the canvas, where the flow starts, at a readable zoom.
 */
function showReadable(
  flow: ReactFlowInstance<CanvasNode>,
  bounds: Bounds | null,
  duration: number,
) {
  if (!bounds) return;
  const pane = document.querySelector(".drawout-canvas .react-flow");
  const width = pane?.clientWidth ?? window.innerWidth;
  const height = pane?.clientHeight ?? window.innerHeight;
  const padding = 48;
  const fitZoom = Math.min(
    (width - padding * 2) / bounds.width,
    (height - padding * 2) / bounds.height,
    1,
  );
  if (fitZoom >= READABLE_ZOOM) {
    void flow.setViewport(
      {
        x: (width - bounds.width * fitZoom) / 2 - bounds.x * fitZoom,
        y: (height - bounds.height * fitZoom) / 2 - bounds.y * fitZoom,
        zoom: fitZoom,
      },
      { duration },
    );
    return;
  }
  void flow.setViewport(
    {
      x: padding - bounds.x * READABLE_ZOOM,
      y: padding + 24 - bounds.y * READABLE_ZOOM,
      zoom: READABLE_ZOOM,
    },
    { duration },
  );
}

function emptyCanvas(threadRef: ScopedThreadRef): ThreadCanvasState {
  return {
    threadId: threadRef.threadId,
    cards: [],
    arrows: [],
    pinned: {},
    nextCard: 1,
    nextArrow: 1,
    revision: 0,
  };
}

function ToolbarButton(props: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="pointer-events-auto flex items-center gap-1.5 rounded-lg border border-border/70 bg-background/80 px-2.5 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur transition-colors hover:bg-muted hover:text-foreground"
    >
      {props.children}
      {props.label}
    </button>
  );
}
