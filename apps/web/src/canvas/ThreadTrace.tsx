/**
 * Draw-out: a thread's traces. A list picks the trace, and the step view shows
 * its cards side by side. The list follows the agent: when it starts a trace
 * or adds to another, that trace shows. A card link in the chat shows its
 * card. Cards take their colour from the repo's areas, else their lane.
 */
import { useAtomValue } from "@effect/atom-react";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { ScopedThreadRef, ThreadCanvasState } from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useActiveProjectTarget } from "~/hooks/useActiveProjectTarget";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { canvasEnvironment } from "~/state/canvas";

import { cardStyle, repoRootOf } from "./areas";
import { onCardReveal } from "./cardRef";
import { TraceView } from "./TraceView";
import { useAreas } from "./useAreas";
import { traceCards } from "./traceSteps";

export default function ThreadTrace({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const result = useAtomValue(
    canvasEnvironment.canvas({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    }),
  );
  const canvas: ThreadCanvasState | null = AsyncResult.isSuccess(result) ? result.value : null;
  const [chosen, setChosen] = useState<string | null>(null);
  const [reveal, setReveal] = useState<{ cardId: string; at: number } | null>(null);
  const cwd = useActiveProjectTarget()?.cwd ?? null;
  const roots = useMemo(
    () =>
      (canvas?.cards ?? []).flatMap((card) => {
        const root = repoRootOf(card, cwd);
        return root ? [root] : [];
      }),
    [canvas?.cards, cwd],
  );
  const areas = useAreas(threadRef.environmentId, roots);
  const styleOf = useCallback(
    (card: Parameters<typeof cardStyle>[0]) => cardStyle(card, areas, cwd),
    [areas, cwd],
  );

  const cards = canvas?.cards;
  useEffect(
    () =>
      onCardReveal((request) => {
        if (request.threadId !== threadRef.threadId) return;
        const card = cards?.find((other) => other.id === request.cardId);
        if (!card) return;
        if (card.trace) setChosen(card.trace);
        setReveal({ cardId: card.id, at: request.at });
      }),
    [cards, threadRef.threadId],
  );

  const traces = canvas?.traces ?? [];
  const agentTrace = canvas?.currentTrace ?? traces.at(-1)?.id ?? null;
  useEffect(() => setChosen(agentTrace), [agentTrace]);
  const traceId = traces.some((trace) => trace.id === chosen) ? chosen : agentTrace;
  const shown = useMemo(() => (canvas ? traceCards(canvas, traceId) : null), [canvas, traceId]);

  if (!canvas || !shown) return <div className="h-full bg-background" />;

  const removeTrace = (id: string) => {
    const trace = traces.find((other) => other.id === id);
    if (!trace || !window.confirm(`Delete the trace "${trace.title}" and its cards?`)) return;
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

  return (
    <TraceView
      key={`${threadRef.threadId}:${traceId}`}
      environmentId={threadRef.environmentId}
      canvas={shown}
      picker={picker}
      styleOf={styleOf}
      reveal={reveal}
    />
  );
}
