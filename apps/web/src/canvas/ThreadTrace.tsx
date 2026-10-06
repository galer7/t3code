/**
 * Draw-out: a thread's trace. The step view by default; Esc shows the
 * overview, a sequence diagram of the steps, and a click there opens a step.
 */
import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef, ThreadCanvasState } from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback, useState } from "react";

import { canvasEnvironment } from "~/state/canvas";

import { SequenceView } from "./SequenceView";
import { TraceView } from "./TraceView";

export default function ThreadTrace({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const result = useAtomValue(
    canvasEnvironment.canvas({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    }),
  );
  const [mode, setMode] = useState<"steps" | "overview">("steps");
  const [focusCardId, setFocusCardId] = useState<string | null>(null);
  const [currentCardId, setCurrentCardId] = useState<string | null>(null);
  const onCardChange = useCallback((cardId: string) => setCurrentCardId(cardId), []);
  const canvas: ThreadCanvasState | null = AsyncResult.isSuccess(result) ? result.value : null;

  if (!canvas) return <div className="h-full bg-background" />;
  if (mode === "overview") {
    return (
      <SequenceView
        canvas={canvas}
        currentCardId={currentCardId}
        onOpen={(cardId) => {
          setFocusCardId(cardId);
          setMode("steps");
        }}
        onBack={() => {
          setFocusCardId(currentCardId);
          setMode("steps");
        }}
      />
    );
  }
  return (
    <TraceView
      environmentId={threadRef.environmentId}
      canvas={canvas}
      focusCardId={focusCardId}
      onOverview={() => setMode("overview")}
      onCardChange={onCardChange}
    />
  );
}
