/**
 * Draw-out: the step view, the one view of a trace. Its cards stand side by
 * side as real editors on their whole files, with the language server and
 * the agent's marks as comments above their lines. Scroll sideways to walk
 * the trace; scroll up and down in an editor to read its file. ← → move one
 * card, Cmd-scroll or + - zoom every editor, and F12 or Cmd-click opens a
 * definition as a side step right after its card; Esc closes it.
 */
import "./canvas.css";

import type {
  CanvasCardRecord,
  CanvasMarkRecord,
  EnvironmentId,
  ThreadCanvasState,
} from "@t3tools/contracts";
import { MinusIcon, PlusIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useTheme } from "~/hooks/useTheme";
import { cn } from "~/lib/utils";

import { LANE_STYLES } from "./laneStyles";
import {
  attachModel,
  lspClientFor,
  type LspStatus,
  readServerFile,
  registerLspProviders,
} from "./lsp";
import { DARK_THEME, LIGHT_THEME, languageForPath, modelFor, monaco } from "./monaco";
import { useProjectPath } from "./projectPath";

const BASE_FONT = 13;
const BASE_WIDTH = 700;
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 1.6;
const ZOOM_KEY = "draw-out:step-zoom";

/** A definition the user opened, shown right after the card it came from. */
interface SideStep {
  readonly key: string;
  readonly afterId: string;
  readonly path: string;
  readonly line: number;
  readonly column: number;
}

type Column =
  | { readonly kind: "card"; readonly key: string; readonly card: CanvasCardRecord }
  | { readonly kind: "side"; readonly key: string; readonly step: SideStep };

/** Which column an editor shows, so go-to-definition knows where it came from. */
const columnOfEditor = new WeakMap<monaco.editor.ICodeEditor, string>();
let openSideStep:
  | ((from: string | null, path: string, line: number, column: number) => void)
  | null = null;
let openerRegistered = false;

function registerOpener() {
  if (openerRegistered) return;
  openerRegistered = true;
  monaco.editor.registerEditorOpener({
    openCodeEditor: (source, resource, selectionOrPosition) => {
      if (!openSideStep) return false;
      const at =
        selectionOrPosition && "startLineNumber" in selectionOrPosition
          ? { line: selectionOrPosition.startLineNumber, column: selectionOrPosition.startColumn }
          : selectionOrPosition
            ? { line: selectionOrPosition.lineNumber, column: selectionOrPosition.column }
            : { line: 1, column: 1 };
      openSideStep(columnOfEditor.get(source) ?? null, resource.path, at.line, at.column);
      return true;
    },
  });
}

const clampZoom = (zoom: number) =>
  Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 20) / 20));

export function TraceView(props: {
  readonly environmentId: EnvironmentId;
  /** The trace's cards and marks. */
  readonly canvas: ThreadCanvasState;
  /** The trace list, shown in the top bar. */
  readonly picker: React.ReactNode;
}) {
  const { environmentId, canvas } = props;
  const projectPath = useProjectPath();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState(() => clampZoom(Number(localStorage.getItem(ZOOM_KEY)) || 1));
  const [sideSteps, setSideSteps] = useState<SideStep[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  useEffect(() => localStorage.setItem(ZOOM_KEY, String(zoom)), [zoom]);

  const columns = useMemo<Column[]>(() => {
    const result: Column[] = [];
    const pending = (afterId: string) =>
      sideSteps
        .filter((step) => step.afterId === afterId)
        .map((step): Column => ({ kind: "side", key: step.key, step }));
    for (const card of canvas.cards) {
      result.push({ kind: "card", key: card.id, card });
      let added = pending(card.id);
      // A side step opened from a side step follows it.
      while (added.length > 0) {
        result.push(...added);
        added = added.flatMap((column) => pending(column.key));
      }
    }
    return result;
  }, [canvas.cards, sideSteps]);
  const width = Math.round(BASE_WIDTH * zoom);
  const fontSize = Math.round(BASE_FONT * zoom * 2) / 2;

  const scrollToColumn = useCallback((key: string) => {
    const element = stripRef.current?.querySelector<HTMLElement>(`[data-column="${key}"]`);
    if (!element) return;
    element.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
    setCurrent(key);
  }, []);

  useEffect(() => {
    openSideStep = (from, path, line, column) => {
      const key = `s${Date.now()}`;
      setSideSteps((steps) => [
        ...steps,
        { key, afterId: from ?? canvas.cards.at(-1)?.id ?? "", path, line, column },
      ]);
      requestAnimationFrame(() => scrollToColumn(key));
    };
    return () => {
      openSideStep = null;
    };
  }, [canvas.cards, scrollToColumn]);

  const move = useCallback(
    (step: 1 | -1) => {
      const index = Math.max(
        0,
        columns.findIndex((column) => column.key === current),
      );
      const next = columns[Math.min(columns.length - 1, Math.max(0, index + step))];
      if (next) scrollToColumn(next.key);
    },
    [columns, current, scrollToColumn],
  );

  const closeSideStep = useCallback((key: string) => {
    setSideSteps((steps) => {
      // Closing a side step closes the ones opened from it.
      const gone = new Set([key]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const step of steps) {
          if (gone.has(step.afterId) && !gone.has(step.key)) {
            gone.add(step.key);
            grew = true;
          }
        }
      }
      return steps.filter((step) => !gone.has(step.key));
    });
  }, []);

  const onKeyDownCapture = (event: React.KeyboardEvent) => {
    if (event.altKey) return;
    const typing = (event.target as HTMLElement).closest("input, select, textarea") !== null;
    if (typing) return;
    if (!event.metaKey && !event.ctrlKey && !event.shiftKey) {
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        event.stopPropagation();
        move(event.key === "ArrowRight" ? 1 : -1);
        return;
      }
      if (event.key === "Escape") {
        const widgetOpen = rootRef.current?.querySelector(
          ".monaco-hover:not(.hidden), .peekview-widget, .find-widget.visible, .suggest-widget.visible",
        );
        if (widgetOpen || sideSteps.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        closeSideStep(sideSteps.at(-1)!.key);
        return;
      }
    }
    if (event.key === "+" || event.key === "=") {
      if (!event.metaKey && !event.ctrlKey) setZoom((value) => clampZoom(value + 0.1));
    } else if (event.key === "-") {
      if (!event.metaKey && !event.ctrlKey) setZoom((value) => clampZoom(value - 0.1));
    }
  };

  // Cmd-scroll zooms every editor; it runs before an editor sees the wheel.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();
      setZoom((value) => clampZoom(value * Math.exp(-event.deltaY * 0.003)));
    };
    root.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => root.removeEventListener("wheel", onWheel, { capture: true });
  }, []);

  if (canvas.cards.length === 0) {
    return (
      <div className="flex h-full flex-col bg-background">
        <div className="flex items-center gap-2 border-b border-border/60 py-2 pr-28 pl-4">
          {props.picker}
        </div>
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          <div className="max-w-sm text-center">
            <p className="font-medium text-foreground">No trace yet</p>
            <p className="mt-1">Ask how a feature works. The code the agent finds shows here.</p>
          </div>
        </div>
      </div>
    );
  }

  const currentColumn = columns.find((column) => column.key === current) ?? columns[0]!;
  const currentPath =
    currentColumn.kind === "card" ? currentColumn.card.path : currentColumn.step.path;
  return (
    <div
      ref={rootRef}
      onKeyDownCapture={onKeyDownCapture}
      className="flex h-full min-h-0 flex-col bg-background outline-none"
    >
      <div className="flex items-center gap-3 border-b border-border/60 py-2 pr-28 pl-4 text-xs">
        {props.picker}
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {canvas.cards.map((card, index) => (
            <button
              key={card.id}
              type="button"
              title={card.title ?? card.path}
              onClick={() => scrollToColumn(card.id)}
              className={cn(
                "flex h-6 min-w-6 shrink-0 items-center justify-center rounded px-1.5 text-xs font-semibold tabular-nums",
                current === card.id || (!current && index === 0)
                  ? "text-background"
                  : "text-foreground/80 hover:bg-muted",
              )}
              style={
                current === card.id || (!current && index === 0)
                  ? { background: LANE_STYLES[card.lane].color }
                  : { boxShadow: `inset 0 -2px 0 ${LANE_STYLES[card.lane].color}` }
              }
            >
              {index + 1}
            </button>
          ))}
        </div>
        <div className="flex shrink-0 items-center rounded-md border border-border/70 p-0.5">
          <ToolButton
            label="Smaller (-)"
            onClick={() => setZoom((value) => clampZoom(value - 0.1))}
          >
            <MinusIcon className="size-3.5" />
          </ToolButton>
          <button
            type="button"
            title="Actual size"
            onClick={() => setZoom(1)}
            className="w-11 text-center text-muted-foreground tabular-nums hover:text-foreground"
          >
            {Math.round(zoom * 100)}%
          </button>
          <ToolButton label="Bigger (+)" onClick={() => setZoom((value) => clampZoom(value + 0.1))}>
            <PlusIcon className="size-3.5" />
          </ToolButton>
        </div>
        <LspChip environmentId={environmentId} path={currentPath} />
      </div>
      <div ref={stripRef} className="flex min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
        {columns.map((column, index) => (
          <StepColumn
            key={column.key}
            column={column}
            index={column.kind === "card" ? canvas.cards.indexOf(column.card) + 1 : null}
            last={index === columns.length - 1}
            environmentId={environmentId}
            width={width}
            fontSize={fontSize}
            current={currentColumn.key === column.key}
            projectPath={projectPath}
            marks={
              column.kind === "card"
                ? (canvas.marks ?? []).filter((mark) => mark.cardId === column.card.id)
                : []
            }
            onFocus={() => setCurrent(column.key)}
            onClose={column.kind === "side" ? () => closeSideStep(column.key) : null}
          />
        ))}
      </div>
    </div>
  );
}

function StepColumn(props: {
  readonly column: Column;
  readonly index: number | null;
  readonly last: boolean;
  readonly environmentId: EnvironmentId;
  readonly width: number;
  readonly fontSize: number;
  readonly current: boolean;
  readonly projectPath: (path: string, repo?: string) => string;
  readonly marks: readonly CanvasMarkRecord[];
  readonly onFocus: () => void;
  readonly onClose: (() => void) | null;
}) {
  const { column } = props;
  const card = column.kind === "card" ? column.card : null;
  const lane = card ? LANE_STYLES[card.lane] : null;
  const path = card ? card.path : column.kind === "side" ? column.step.path : "";
  const shownPath = card
    ? `${props.projectPath(card.path, card.repo)}:${card.startLine}–${card.endLine}`
    : column.kind === "side"
      ? `${props.projectPath(column.step.path)}:${column.step.line}`
      : "";
  return (
    <div
      data-column={column.key}
      onPointerDownCapture={props.onFocus}
      className={cn(
        "drawout-step-column flex h-full shrink-0 flex-col border-r border-border/60",
        props.current && "drawout-step-column-current",
        column.kind === "side" && "drawout-step-column-side",
      )}
      style={
        {
          width: props.width,
          "--lane": lane?.color ?? "var(--muted-foreground)",
        } as React.CSSProperties
      }
    >
      <div className="drawout-step-column-header shrink-0 px-4 pt-2.5 pb-2">
        <div className="flex items-center gap-2">
          {props.index !== null ? (
            <span className="drawout-step-number shrink-0 rounded px-1.5 text-sm font-bold tabular-nums">
              {props.index}
            </span>
          ) : null}
          <span className="drawout-step-lane shrink-0 text-xs font-bold tracking-wider uppercase">
            {lane ? lane.label : "Side step"}
          </span>
          <h3 className="min-w-0 flex-1 truncate text-base font-semibold">
            {card ? (card.title ?? card.path.split("/").pop()) : path.split("/").pop()}
          </h3>
          {props.onClose ? (
            <button
              type="button"
              aria-label="Close the side step (Esc)"
              title="Close the side step (Esc)"
              onClick={props.onClose}
              className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <XIcon className="size-4" />
            </button>
          ) : null}
        </div>
        <div
          className="mt-0.5 truncate font-mono text-sm font-medium text-foreground/85"
          style={{ direction: "rtl", textAlign: "left" }}
        >
          <bdi>{shownPath}</bdi>
        </div>
        {card?.caption ? (
          <p className="mt-1 line-clamp-3 text-sm leading-5 text-foreground/80">{card.caption}</p>
        ) : null}
      </div>
      <ColumnEditor
        environmentId={props.environmentId}
        columnKey={column.key}
        path={path}
        range={card ? { start: card.startLine, end: card.endLine } : null}
        line={column.kind === "side" ? column.step.line : null}
        marks={props.marks}
        fontSize={props.fontSize}
      />
    </div>
  );
}

/** A comment's opening for the file's language. */
function commentPrefix(languageId: string): string {
  return ["ruby", "python", "shell", "yaml", "dockerfile", "perl", "r", "coffeescript"].includes(
    languageId,
  )
    ? "#"
    : "//";
}

/** Each mark as a comment line above its first line, in the tone's colour. */
function showMarkZones(
  editor: monaco.editor.IStandaloneCodeEditor,
  zoneIdsRef: React.MutableRefObject<string[]>,
  marks: readonly CanvasMarkRecord[],
  lineHeight: number,
) {
  const prefix = commentPrefix(editor.getModel()?.getLanguageId() ?? "");
  const width = editor.getLayoutInfo().contentWidth;
  const charsPerLine = Math.max(30, Math.floor(width / (lineHeight * 0.4)) - 4);
  editor.changeViewZones((accessor) => {
    for (const id of zoneIdsRef.current) accessor.removeZone(id);
    zoneIdsRef.current = marks.map((mark) => {
      const domNode = document.createElement("div");
      domNode.className = `drawout-mark-zone drawout-mark-${mark.tone}`;
      domNode.style.lineHeight = `${lineHeight}px`;
      domNode.style.fontSize = `${Math.round(lineHeight * 0.6 * 2) / 2}px`;
      domNode.textContent = `${prefix} ${mark.text}`;
      const lines = Math.ceil((mark.text.length + prefix.length + 1) / charsPerLine);
      return accessor.addZone({
        afterLineNumber: mark.startLine - 1,
        heightInPx: lines * lineHeight + 6,
        domNode,
      });
    });
  });
}

/** A real editor on the whole file, opened at the card's range or the side step's line. */
function ColumnEditor(props: {
  readonly environmentId: EnvironmentId;
  readonly columnKey: string;
  readonly path: string;
  readonly range: { readonly start: number; readonly end: number } | null;
  readonly line: number | null;
  readonly marks: readonly CanvasMarkRecord[];
  readonly fontSize: number;
}) {
  const { environmentId, path, range, line, fontSize } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const decorationsRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const zoneIdsRef = useRef<string[]>([]);
  const placedRef = useRef(false);
  const { resolvedTheme } = useTheme();
  const [model, setModel] = useState<monaco.editor.ITextModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lineHeight = Math.round(fontSize * 1.55);
  // The marks' contents, so a new canvas revision with the same marks changes nothing.
  const marksKey = JSON.stringify(props.marks);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    registerLspProviders();
    registerOpener();
    const editor = monaco.editor.create(host, {
      theme: resolvedTheme === "dark" ? DARK_THEME : LIGHT_THEME,
      readOnly: true,
      automaticLayout: true,
      fontFamily:
        getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim() ||
        "monospace",
      fontSize,
      lineHeight,
      minimap: { enabled: false },
      wordWrap: "on",
      scrollBeyondLastLine: false,
      stickyScroll: { enabled: true },
      padding: { top: 6, bottom: 6 },
      renderLineHighlight: "none",
      cursorStyle: "line-thin",
      contextmenu: true,
      definitionLinkOpensInPeek: false,
      lineNumbersMinChars: 3,
      folding: false,
      overviewRulerLanes: 2,
      // A wheel the file cannot use goes on to the strip, which scrolls sideways.
      scrollbar: { alwaysConsumeMouseWheel: false, horizontal: "hidden" },
    });
    columnOfEditor.set(editor, props.columnKey);
    editorRef.current = editor;
    decorationsRef.current = editor.createDecorationsCollection();
    return () => {
      editor.dispose();
      editorRef.current = null;
    };
    // One editor per column; the file, zoom and marks change below.
  }, []);

  useEffect(() => {
    monaco.editor.setTheme(resolvedTheme === "dark" ? DARK_THEME : LIGHT_THEME);
  }, [resolvedTheme]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const existing = monaco.editor.getModel(monaco.Uri.file(path));
      const contents = existing ? null : await readServerFile(environmentId, path);
      if (cancelled) return;
      const loaded = existing ?? (contents === null ? null : modelFor(path, contents));
      setError(loaded ? null : `Could not read ${path}`);
      if (loaded) attachModel(environmentId, loaded);
      setModel(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [environmentId, path]);

  useEffect(() => {
    editorRef.current?.updateOptions({ fontSize, lineHeight });
  }, [fontSize, lineHeight]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !model) return;
    if (editor.getModel() !== model) editor.setModel(model);
    const marks: CanvasMarkRecord[] = JSON.parse(marksKey);
    const focus = range ? range.start : (line ?? 1);
    decorationsRef.current?.set([
      ...(range
        ? [
            {
              range: new monaco.Range(range.start, 1, range.end, 1),
              options: {
                isWholeLine: true,
                className: "drawout-step-range",
                linesDecorationsClassName: "drawout-range-gutter",
              },
            },
          ]
        : line
          ? [
              {
                range: new monaco.Range(line, 1, line, 1),
                options: {
                  isWholeLine: true,
                  className: "drawout-side-line",
                  linesDecorationsClassName: "drawout-range-gutter",
                },
              },
            ]
          : []),
      ...marks.map((mark) => ({
        range: new monaco.Range(mark.startLine, 1, mark.endLine, 1),
        options: {
          isWholeLine: true,
          className: `drawout-mark-line drawout-mark-${mark.tone}`,
          hoverMessage: { value: mark.text },
        },
      })),
    ]);
    showMarkZones(editor, zoneIdsRef, marks, lineHeight);
    // Open at the range once; later changes keep the user's scroll.
    if (!placedRef.current) {
      placedRef.current = true;
      editor.setScrollTop(Math.max(0, editor.getTopForLineNumber(focus) - 3 * lineHeight));
      editor.setPosition({ lineNumber: focus, column: 1 });
    }
  }, [line, lineHeight, marksKey, model, range?.end, range?.start]);

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={hostRef} className="drawout-step-editor absolute inset-0" />
      {error ? (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          {error}
        </div>
      ) : null}
    </div>
  );
}

function LspChip({
  environmentId,
  path,
}: {
  readonly environmentId: EnvironmentId;
  readonly path: string;
}) {
  const [status, setStatus] = useState<LspStatus | "none">("starting");
  const [name, setName] = useState<string>("");
  useEffect(() => {
    let unsubscribe = () => {};
    let cancelled = false;
    const languageId = languageForPath(path);
    setName(languageId === "plaintext" ? "This file" : languageId);
    void (async () => {
      if (languageId === "plaintext") {
        setStatus("none");
        return;
      }
      const pending = lspClientFor(environmentId, path, languageId);
      setStatus("starting");
      const client = await pending;
      if (cancelled) return;
      setStatus(client.status);
      unsubscribe = client.onStatus(() => setStatus(client.status));
    })();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [environmentId, path]);
  const label =
    status === "ready"
      ? `${name}: language server on`
      : status === "starting"
        ? `${name}: language server starting…`
        : `${name}: no language server, so no hover or definitions`;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]",
        status === "ready"
          ? "border-emerald-500/30 text-emerald-400"
          : status === "starting"
            ? "border-amber-500/30 text-amber-400"
            : "border-border text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          status === "ready"
            ? "bg-emerald-400"
            : status === "starting"
              ? "animate-pulse bg-amber-400"
              : "bg-muted-foreground",
        )}
      />
      {label}
    </span>
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
