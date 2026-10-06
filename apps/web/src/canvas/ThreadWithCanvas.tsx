/**
 * Draw-out: one thread, one chat, one canvas. The chat sits on the left and
 * the canvas fills the rest; drag the divider to resize. On a narrow screen
 * a switch shows one of them at a time.
 */
import type { ScopedThreadRef } from "@t3tools/contracts";
import { MessageSquareIcon, WorkflowIcon } from "lucide-react";
import { lazy, type ReactNode, Suspense, useCallback, useEffect, useState } from "react";

import { cn } from "~/lib/utils";

const ThreadCanvas = lazy(() => import("./ThreadCanvas"));

const WIDTH_KEY = "draw-out:chat-width";
const OPEN_KEY = "draw-out:canvas-open";
const MIN_CHAT = 340;
const NARROW_QUERY = "(max-width: 1023px)";

function readNumber(key: string, fallback: number): number {
  const value = Number(localStorage.getItem(key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(NARROW_QUERY);
    const update = () => setNarrow(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return narrow;
}

export function ThreadWithCanvas(props: {
  readonly threadRef: ScopedThreadRef | null;
  readonly children: ReactNode;
}) {
  const { threadRef, children } = props;
  const narrow = useNarrow();
  const [chatWidth, setChatWidth] = useState(() => readNumber(WIDTH_KEY, 460));
  const [canvasOpen, setCanvasOpen] = useState(() => localStorage.getItem(OPEN_KEY) !== "false");
  const [narrowView, setNarrowView] = useState<"chat" | "canvas">("chat");

  const toggleCanvas = useCallback((open: boolean) => {
    setCanvasOpen(open);
    localStorage.setItem(OPEN_KEY, String(open));
  }, []);

  const startResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = chatWidth;
      let width = startWidth;
      const move = (moveEvent: PointerEvent) => {
        width = Math.min(
          Math.max(MIN_CHAT, startWidth + moveEvent.clientX - startX),
          window.innerWidth - 420,
        );
        setChatWidth(width);
      };
      const up = () => {
        localStorage.setItem(WIDTH_KEY, String(Math.round(width)));
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        document.body.style.removeProperty("cursor");
      };
      document.body.style.cursor = "col-resize";
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [chatWidth],
  );

  if (!threadRef) return <>{children}</>;

  const canvas = (
    <Suspense fallback={<div className="h-full w-full bg-background" />}>
      <ThreadCanvas threadRef={threadRef} />
    </Suspense>
  );

  if (narrow) {
    return (
      <div className="relative flex h-full min-h-0 flex-col">
        <div className={cn("min-h-0 flex-1", narrowView === "chat" ? "flex flex-col" : "hidden")}>
          {children}
        </div>
        {narrowView === "canvas" ? <div className="min-h-0 flex-1">{canvas}</div> : null}
        <div className="absolute top-2 left-1/2 z-20 flex -translate-x-1/2 rounded-full border border-border/70 bg-background/90 p-0.5 shadow-sm backdrop-blur">
          {(["chat", "canvas"] as const).map((view) => (
            <button
              key={view}
              type="button"
              onClick={() => setNarrowView(view)}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs capitalize",
                narrowView === view ? "bg-muted text-foreground" : "text-muted-foreground",
              )}
            >
              {view === "chat" ? (
                <MessageSquareIcon className="size-3.5" />
              ) : (
                <WorkflowIcon className="size-3.5" />
              )}
              {view}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (!canvasOpen) {
    return (
      <div className="relative flex h-full min-h-0 flex-col">
        {children}
        <button
          type="button"
          onClick={() => toggleCanvas(true)}
          className="absolute top-1/2 right-0 z-20 flex -translate-y-1/2 items-center gap-1.5 rounded-l-lg border border-r-0 border-border/70 bg-background/90 px-2 py-3 text-xs text-muted-foreground shadow-sm backdrop-blur [writing-mode:vertical-rl] hover:text-foreground"
        >
          <WorkflowIcon className="size-3.5 rotate-90" />
          Canvas
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-h-0 shrink-0 flex-col" style={{ width: chatWidth }}>
        {children}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        onPointerDown={startResize}
        onDoubleClick={() => toggleCanvas(false)}
        title="Drag to resize. Double-click to hide the canvas."
        className="group relative w-px shrink-0 cursor-col-resize bg-border"
      >
        <div className="absolute inset-y-0 -left-1.5 w-3 transition-colors group-hover:bg-primary/20" />
      </div>
      <div className="min-h-0 min-w-0 flex-1">{canvas}</div>
    </div>
  );
}
