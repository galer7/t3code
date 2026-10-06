/**
 * Draw-out: a code card. A real Monaco editor on the file, scrolled to the
 * card's range. Drag the header to move the card; select the card to scroll
 * its code with the wheel.
 */
import { useAtomValue } from "@effect/atom-react";
import type { CanvasCardRecord as CanvasCard, EnvironmentId } from "@t3tools/contracts";
import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { AsyncResult } from "effect/unstable/reactivity";
import { XIcon } from "lucide-react";
import { memo, useEffect, useRef } from "react";

import { useTheme } from "~/hooks/useTheme";
import { cn } from "~/lib/utils";
import { projectEnvironment } from "~/state/projects";

import { CARD_WIDTH, CODE_LINE_HEIGHT, visibleLineCount } from "./canvasLayout";
import { LANE_STYLES } from "./laneStyles";
import { DARK_THEME, LIGHT_THEME, modelFor, monaco } from "./monaco";

export type CodeCardNode = Node<
  {
    readonly card: CanvasCard;
    readonly environmentId: EnvironmentId;
    readonly onRemove: (cardId: string) => void;
  },
  "code"
>;

export const CodeCardView = memo(function CodeCardView({
  data,
  selected,
}: NodeProps<CodeCardNode>) {
  const { card, environmentId, onRemove } = data;
  const lane = LANE_STYLES[card.lane];
  const slash = card.path.lastIndexOf("/");
  const fileName = card.path.slice(slash + 1);
  const shortPath = card.path.split("/").slice(-3).join("/");
  return (
    <div
      className={cn(
        "group/card overflow-hidden rounded-xl border bg-card text-card-foreground shadow-lg shadow-black/20 transition-[box-shadow,border-color] duration-200",
        selected ? "border-primary/60 ring-2 ring-primary/25" : "border-border/70",
      )}
      style={{ width: CARD_WIDTH }}
    >
      <Handle type="target" position={Position.Left} id="left" className="drawout-handle" />
      <Handle type="source" position={Position.Left} id="left-source" className="drawout-handle" />
      <Handle type="source" position={Position.Right} id="right" className="drawout-handle" />
      <Handle
        type="target"
        position={Position.Right}
        id="right-target"
        className="drawout-handle"
      />
      <Handle type="target" position={Position.Top} id="top" className="drawout-handle" />
      <Handle type="source" position={Position.Top} id="top-source" className="drawout-handle" />
      <Handle type="source" position={Position.Bottom} id="bottom" className="drawout-handle" />
      <Handle
        type="target"
        position={Position.Bottom}
        id="bottom-target"
        className="drawout-handle"
      />
      <div className="flex cursor-grab items-center gap-2 border-b border-border/60 px-3 py-2 active:cursor-grabbing">
        <span className="size-2 shrink-0 rounded-full" style={{ background: lane.color }} />
        <span className="truncate text-[13px] font-semibold">{card.title ?? fileName}</span>
        <span
          className="min-w-0 flex-1 truncate text-right font-mono text-[11px] text-muted-foreground"
          title={`${card.path}:${card.startLine}-${card.endLine}`}
        >
          {shortPath}:{card.startLine}–{card.endLine}
        </span>
        <span className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {card.id}
        </span>
        <button
          type="button"
          className="nodrag rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover/card:opacity-100"
          aria-label="Remove card"
          onClick={() => onRemove(card.id)}
        >
          <XIcon className="size-3.5" />
        </button>
      </div>
      {card.caption ? (
        <p className="border-b border-border/40 px-3 py-2 text-[12.5px] leading-[18px] text-muted-foreground">
          {card.caption}
        </p>
      ) : null}
      <CardCode card={card} environmentId={environmentId} selected={Boolean(selected)} />
    </div>
  );
});

function CardCode(props: {
  readonly card: CanvasCard;
  readonly environmentId: EnvironmentId;
  readonly selected: boolean;
}) {
  const { card, environmentId, selected } = props;
  const slash = card.path.lastIndexOf("/");
  const file = useAtomValue(
    projectEnvironment.readFile({
      environmentId,
      input: { cwd: card.path.slice(0, slash) || "/", relativePath: card.path.slice(slash + 1) },
    }),
  );
  const height = visibleLineCount(card) * CODE_LINE_HEIGHT + 12;
  if (AsyncResult.isSuccess(file)) {
    return (
      <CardEditor card={card} contents={file.value.contents} height={height} selected={selected} />
    );
  }
  return (
    <div
      className="flex items-center justify-center text-xs text-muted-foreground"
      style={{ height }}
    >
      {AsyncResult.isFailure(file) ? `Could not read ${card.path}` : "Loading…"}
    </div>
  );
}

function CardEditor(props: {
  readonly card: CanvasCard;
  readonly contents: string;
  readonly height: number;
  readonly selected: boolean;
}) {
  const { card, contents, height, selected } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const editor = monaco.editor.create(host, {
      model: modelFor(card.path, contents),
      theme: resolvedTheme === "dark" ? DARK_THEME : LIGHT_THEME,
      readOnly: true,
      domReadOnly: true,
      automaticLayout: false,
      dimension: { width: CARD_WIDTH - 2, height: props.height },
      fontFamily:
        getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim() ||
        "monospace",
      fontSize: 12.5,
      lineHeight: CODE_LINE_HEIGHT,
      minimap: { enabled: false },
      folding: false,
      glyphMargin: false,
      lineDecorationsWidth: 10,
      lineNumbersMinChars: 4,
      renderLineHighlight: "none",
      scrollBeyondLastLine: false,
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      contextmenu: false,
      stickyScroll: { enabled: false },
      padding: { top: 6, bottom: 6 },
      scrollbar: {
        verticalScrollbarSize: 8,
        horizontalScrollbarSize: 8,
        alwaysConsumeMouseWheel: false,
      },
    });
    editor.createDecorationsCollection([
      {
        range: new monaco.Range(card.startLine, 1, card.endLine, 1),
        options: { isWholeLine: true, linesDecorationsClassName: "drawout-range-gutter" },
      },
    ]);
    editor.setScrollTop(Math.max(0, editor.getTopForLineNumber(card.startLine) - 6));
    editorRef.current = editor;
    return () => {
      editor.dispose();
      editorRef.current = null;
    };
    // The editor is created once per card; theme and height update below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.path, card.startLine, card.endLine]);

  useEffect(() => {
    if (editorRef.current) modelFor(card.path, contents);
  }, [card.path, contents]);

  useEffect(() => {
    monaco.editor.setTheme(resolvedTheme === "dark" ? DARK_THEME : LIGHT_THEME);
  }, [resolvedTheme]);

  useEffect(() => {
    editorRef.current?.layout({ width: CARD_WIDTH - 2, height });
  }, [height]);

  // Until the card is selected, the wheel and drags go to the canvas.
  return (
    <div
      ref={hostRef}
      className={selected ? "nodrag nowheel" : "pointer-events-none"}
      style={{ height }}
    />
  );
}
