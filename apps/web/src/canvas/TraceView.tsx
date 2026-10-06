/**
 * Draw-out: the step view. One step of the agent's trace fills the zone, as a
 * real editor on the whole file with the language server. ← → walk the flow,
 * ↑ ↓ switch branches, F12 or Cmd-click opens a definition as a side step,
 * Esc goes back from a side step or shows the overview, F is fullscreen.
 */
import "./canvas.css";

import type { CanvasCardRecord, EnvironmentId, ThreadCanvasState } from "@t3tools/contracts";
import { ChevronLeftIcon, ChevronRightIcon, MaximizeIcon, WorkflowIcon } from "lucide-react";
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
import {
  CODE_LINE_HEIGHT,
  DARK_THEME,
  LIGHT_THEME,
  languageForPath,
  modelFor,
  monaco,
} from "./monaco";
import { traceColumns } from "./traceSteps";

interface SideStep {
  readonly path: string;
  readonly line: number;
  readonly column: number;
}

/** Where the step view sends go-to-definition: the mounted step view's handler. */
let openSideStep: ((step: SideStep) => void) | null = null;
let openerRegistered = false;

function registerOpener() {
  if (openerRegistered) return;
  openerRegistered = true;
  monaco.editor.registerEditorOpener({
    openCodeEditor: (_source, resource, selectionOrPosition) => {
      if (!openSideStep) return false;
      const at =
        selectionOrPosition && "startLineNumber" in selectionOrPosition
          ? { line: selectionOrPosition.startLineNumber, column: selectionOrPosition.startColumn }
          : selectionOrPosition
            ? { line: selectionOrPosition.lineNumber, column: selectionOrPosition.column }
            : { line: 1, column: 1 };
      openSideStep({ path: resource.path, ...at });
      return true;
    },
  });
}

export function TraceView(props: {
  readonly environmentId: EnvironmentId;
  readonly canvas: ThreadCanvasState;
  readonly focusCardId: string | null;
  readonly onOverview: () => void;
  readonly onCardChange: (cardId: string) => void;
}) {
  const { environmentId, canvas, focusCardId, onOverview, onCardChange } = props;
  const columns = useMemo(() => traceColumns(canvas), [canvas]);
  const cardsById = useMemo(
    () => new Map(canvas.cards.map((card) => [card.id, card])),
    [canvas.cards],
  );
  const [place, setPlace] = useState({ column: 0, row: 0 });
  const [sideSteps, setSideSteps] = useState<SideStep[]>([]);
  const zoneRef = useRef<HTMLDivElement | null>(null);

  // Open at the card the overview asked for.
  useEffect(() => {
    if (!focusCardId) return;
    columns.forEach((column, columnIndex) => {
      const row = column.indexOf(focusCardId);
      if (row >= 0) setPlace({ column: columnIndex, row });
    });
    setSideSteps([]);
    // Only a new request moves the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusCardId]);

  const column = Math.min(place.column, Math.max(columns.length - 1, 0));
  const row = Math.min(place.row, Math.max((columns[column]?.length ?? 1) - 1, 0));
  const card = cardsById.get(columns[column]?.[row] ?? "") ?? null;
  const sideStep = sideSteps.at(-1) ?? null;
  useEffect(() => {
    if (card) onCardChange(card.id);
  }, [card, onCardChange]);

  const move = useCallback(
    (direction: "left" | "right" | "up" | "down") => {
      if (direction === "left" && sideSteps.length > 0) {
        setSideSteps((steps) => steps.slice(0, -1));
        return;
      }
      setSideSteps([]);
      setPlace(({ column: currentColumn, row: currentRow }) => {
        if (direction === "right")
          return { column: Math.min(currentColumn + 1, columns.length - 1), row: 0 };
        if (direction === "left") return { column: Math.max(currentColumn - 1, 0), row: 0 };
        const height = columns[currentColumn]?.length ?? 1;
        return {
          column: currentColumn,
          row:
            direction === "down"
              ? Math.min(currentRow + 1, height - 1)
              : Math.max(currentRow - 1, 0),
        };
      });
    },
    [columns, sideSteps.length],
  );

  useEffect(() => {
    openSideStep = (step) => setSideSteps((steps) => [...steps, step]);
    return () => {
      openSideStep = null;
    };
  }, []);

  const onKeyDownCapture = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey) return;
      const directions: Record<string, "left" | "right" | "up" | "down"> = {
        ArrowLeft: "left",
        ArrowRight: "right",
        ArrowUp: "up",
        ArrowDown: "down",
      };
      const direction = directions[event.key];
      if (direction) {
        event.preventDefault();
        event.stopPropagation();
        move(direction);
        return;
      }
      if (event.key === "Escape") {
        // Esc first closes an open hover, peek or find box in the editor.
        const zone = zoneRef.current;
        const widgetOpen = zone?.querySelector(
          ".monaco-hover:not(.hidden), .peekview-widget, .find-widget.visible, .suggest-widget.visible",
        );
        if (widgetOpen) return;
        event.preventDefault();
        event.stopPropagation();
        if (sideSteps.length > 0) setSideSteps((steps) => steps.slice(0, -1));
        else onOverview();
        return;
      }
      const inEditor = (event.target as HTMLElement).closest(".monaco-editor") !== null;
      if (!inEditor && (event.key === "f" || event.key === "F")) {
        event.preventDefault();
        void (document.fullscreenElement
          ? document.exitFullscreen()
          : zoneRef.current?.requestFullscreen());
      }
    },
    [move, onOverview, sideSteps.length],
  );

  useEffect(() => {
    zoneRef.current?.focus();
  }, []);

  if (!card) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <div className="max-w-sm text-center">
          <p className="font-medium text-foreground">No trace yet</p>
          <p className="mt-1">
            Ask how a feature works. The agent's steps show here, one at a time.
          </p>
        </div>
      </div>
    );
  }

  const incoming = canvas.arrows.filter((arrow) => arrow.to === card.id);
  const lane = LANE_STYLES[card.lane];
  return (
    <div
      ref={zoneRef}
      tabIndex={0}
      onKeyDownCapture={onKeyDownCapture}
      className="flex h-full min-h-0 flex-col bg-background outline-none"
    >
      <div className="flex items-start gap-3 border-b border-border/60 py-3 pr-28 pl-5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            <span className="size-2 rounded-full" style={{ background: lane.color }} />
            {lane.label} · step {column + 1} of {columns.length}
            {(columns[column]?.length ?? 1) > 1
              ? ` · branch ${row + 1} of ${columns[column]!.length}`
              : ""}
            {sideStep ? ` · side step ${sideSteps.length}` : ""}
          </div>
          <div className="mt-1 flex items-baseline gap-3">
            <h2 className="truncate text-base font-semibold">
              {sideStep
                ? sideStep.path.split("/").pop()
                : (card.title ?? card.path.split("/").pop())}
            </h2>
            <span className="truncate font-mono text-xs text-muted-foreground">
              {sideStep
                ? `${shortPath(sideStep.path)}:${sideStep.line}`
                : `${shortPath(card.path)}:${card.startLine}–${card.endLine}`}
            </span>
          </div>
          {sideStep ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Your side step from {card.title ?? card.id}. Esc or ← goes back.
            </p>
          ) : (
            <>
              {incoming.length > 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {incoming
                    .map((arrow) => {
                      const from = cardsById.get(arrow.from);
                      return `← ${arrow.label ?? "from"} ${from?.title ?? arrow.from}`;
                    })
                    .join("  ·  ")}
                </p>
              ) : null}
              {card.caption ? <p className="mt-1.5 text-sm leading-5">{card.caption}</p> : null}
            </>
          )}
        </div>
      </div>
      <StepEditor environmentId={environmentId} card={card} sideStep={sideStep} />
      <StepStrip
        columns={columns}
        cardsById={cardsById}
        current={{ column, row }}
        onSelect={(next) => {
          setSideSteps([]);
          setPlace(next);
          zoneRef.current?.focus();
        }}
      >
        <LspChip environmentId={environmentId} path={sideStep?.path ?? card.path} />
        <StripButton label="Previous step (←)" onClick={() => move("left")}>
          <ChevronLeftIcon className="size-4" />
        </StripButton>
        <StripButton label="Next step (→)" onClick={() => move("right")}>
          <ChevronRightIcon className="size-4" />
        </StripButton>
        <StripButton label="Overview (Esc)" onClick={onOverview}>
          <WorkflowIcon className="size-4" />
        </StripButton>
        <StripButton
          label="Fullscreen (F)"
          onClick={() => void zoneRef.current?.requestFullscreen()}
        >
          <MaximizeIcon className="size-4" />
        </StripButton>
      </StepStrip>
    </div>
  );
}

function shortPath(path: string): string {
  return path.split("/").slice(-3).join("/");
}

function StepEditor(props: {
  readonly environmentId: EnvironmentId;
  readonly card: CanvasCardRecord;
  readonly sideStep: SideStep | null;
}) {
  const { environmentId, card, sideStep } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const decorationsRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const { resolvedTheme } = useTheme();
  const [error, setError] = useState<string | null>(null);

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
      fontSize: 13,
      lineHeight: CODE_LINE_HEIGHT,
      minimap: { enabled: true, renderCharacters: false, scale: 1 },
      scrollBeyondLastLine: false,
      stickyScroll: { enabled: true },
      padding: { top: 8, bottom: 8 },
      renderLineHighlight: "none",
      cursorStyle: "line-thin",
      contextmenu: true,
      definitionLinkOpensInPeek: false,
    });
    editorRef.current = editor;
    decorationsRef.current = editor.createDecorationsCollection();
    return () => {
      editor.dispose();
      editorRef.current = null;
    };
    // One editor for the step view; models change below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    monaco.editor.setTheme(resolvedTheme === "dark" ? DARK_THEME : LIGHT_THEME);
  }, [resolvedTheme]);

  const path = sideStep?.path ?? card.path;
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const existing = monaco.editor.getModel(monaco.Uri.file(path));
      const contents = existing ? null : await readServerFile(environmentId, path);
      if (cancelled) return;
      const model = existing ?? (contents === null ? null : modelFor(path, contents));
      const editor = editorRef.current;
      if (!model || !editor) {
        setError(`Could not read ${path}`);
        return;
      }
      setError(null);
      attachModel(environmentId, model);
      editor.setModel(model);
      if (sideStep) {
        decorationsRef.current?.set([
          {
            range: new monaco.Range(sideStep.line, 1, sideStep.line, 1),
            options: {
              isWholeLine: true,
              className: "drawout-side-line",
              linesDecorationsClassName: "drawout-range-gutter",
            },
          },
        ]);
        editor.revealLineInCenter(sideStep.line);
        editor.setPosition({ lineNumber: sideStep.line, column: sideStep.column });
      } else {
        decorationsRef.current?.set([
          {
            range: new monaco.Range(card.startLine, 1, card.endLine, 1),
            options: {
              isWholeLine: true,
              className: "drawout-step-range",
              linesDecorationsClassName: "drawout-range-gutter",
            },
          },
        ]);
        editor.setScrollTop(
          Math.max(0, editor.getTopForLineNumber(card.startLine) - 3 * CODE_LINE_HEIGHT),
        );
        editor.setPosition({ lineNumber: card.startLine, column: 1 });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [card.endLine, card.startLine, environmentId, path, sideStep]);

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

function StepStrip(props: {
  readonly columns: readonly (readonly string[])[];
  readonly cardsById: ReadonlyMap<string, CanvasCardRecord>;
  readonly current: { readonly column: number; readonly row: number };
  readonly onSelect: (place: { column: number; row: number }) => void;
  readonly children: React.ReactNode;
}) {
  const { columns, cardsById, current, onSelect, children } = props;
  return (
    <div className="flex items-center gap-3 border-t border-border/60 px-5 py-2">
      <div className="flex min-w-0 flex-1 items-start gap-1.5 overflow-x-auto">
        {columns.map((column, columnIndex) => (
          <div key={column.join(",")} className="flex flex-col gap-1">
            {column.map((id, rowIndex) => {
              const card = cardsById.get(id);
              const active = current.column === columnIndex && current.row === rowIndex;
              return (
                <button
                  key={id}
                  type="button"
                  title={card?.title ?? id}
                  onClick={() => onSelect({ column: columnIndex, row: rowIndex })}
                  className={cn(
                    "h-1.5 w-8 rounded-full transition-colors",
                    active ? "bg-primary" : "bg-muted-foreground/25 hover:bg-muted-foreground/50",
                  )}
                  style={
                    active
                      ? undefined
                      : {
                          boxShadow: `inset 0 -2px 0 ${card ? LANE_STYLES[card.lane].color : "transparent"}55`,
                        }
                  }
                />
              );
            })}
          </div>
        ))}
      </div>
      <span className="hidden shrink-0 text-[11px] text-muted-foreground xl:inline">
        ← → steps · ↑ ↓ branches · Cmd-click definition · Esc back
      </span>
      {children}
    </div>
  );
}

function StripButton(props: {
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
      className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {props.children}
    </button>
  );
}
