/**
 * Draw-out: a thread's traces. A list picks the trace; the gallery shows all
 * of its cards, and a click on one walks the trace from there in the step
 * view. Esc in the step view goes back to the gallery. The list follows the
 * agent: when it starts a trace or adds to another, that trace shows.
 */
import { useAtomValue } from "@effect/atom-react";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { ScopedThreadRef, ThreadCanvasState } from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { canvasEnvironment } from "~/state/canvas";

import { GalleryView } from "./GalleryView";
import { TraceView } from "./TraceView";
import { traceCards } from "./traceSteps";

export default function ThreadTrace({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const result = useAtomValue(
    canvasEnvironment.canvas({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    }),
  );
  const canvas: ThreadCanvasState | null = AsyncResult.isSuccess(result) ? result.value : null;
  const [mode, setMode] = useState<"gallery" | "steps">("gallery");
  const [focusCardId, setFocusCardId] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const onCardChange = useCallback(() => {}, []);

  const traces = canvas?.traces ?? [];
  const agentTrace = canvas?.currentTrace ?? traces.at(-1)?.id ?? null;
  useEffect(() => setChosen(agentTrace), [agentTrace]);
  const traceId = traces.some((trace) => trace.id === chosen) ? chosen : agentTrace;
  const shown = useMemo(() => (canvas ? traceCards(canvas, traceId) : null), [canvas, traceId]);

  if (!canvas || !shown) return <div className="h-full bg-background" />;

  const removeTrace = (id: string) => {
    const trace = traces.find((other) => other.id === id);
    if (!trace || !window.confirm(`Delete the trace "${trace.title}" and its cards?`)) return;
    setMode("gallery");
    void runAtomCommand(
      appAtomRegistry,
      canvasEnvironment.edit,
      {
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, edit: { type: "removeTrace", traceId: id } },
      },
      { label: "delete trace" },
    );
  };

  const picker =
    traces.length > 0 ? (
      <div className="flex shrink-0 items-center gap-1">
        <select
          value={traceId ?? ""}
          onChange={(event) => {
            setChosen(event.target.value);
            setMode("gallery");
          }}
          aria-label="Trace"
          className="h-7 max-w-64 shrink-0 truncate rounded-md border border-border/70 bg-background px-2 text-xs"
        >
          {traces.map((trace) => (
            <option key={trace.id} value={trace.id}>
              {trace.title} ({canvas.cards.filter((card) => card.trace === trace.id).length})
            </option>
          ))}
        </select>
        {traceId ? (
          <button
            type="button"
            aria-label="Delete this trace"
            title="Delete this trace"
            onClick={() => removeTrace(traceId)}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Trash2Icon className="size-3.5" />
          </button>
        ) : null}
      </div>
    ) : null;

  if (mode === "gallery") {
    return (
      <GalleryView
        key={`${threadRef.threadId}:${traceId}`}
        environmentId={threadRef.environmentId}
        canvas={shown}
        layoutKey={`${threadRef.threadId}:${traceId}`}
        picker={picker}
        onSteps={(cardId) => {
          setFocusCardId(cardId);
          setMode("steps");
        }}
      />
    );
  }
  return (
    <TraceView
      key={`${threadRef.threadId}:${traceId}`}
      environmentId={threadRef.environmentId}
      canvas={shown}
      focusCardId={focusCardId}
      picker={picker}
      onOverview={() => setMode("gallery")}
      onCardChange={onCardChange}
    />
  );
}
