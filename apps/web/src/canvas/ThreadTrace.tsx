/**
 * Draw-out: a thread's trace. The step view by default; Esc shows the
 * overview canvas, and double-clicking a card there opens it as a step.
 */
import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef, ThreadCanvasState } from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { useState } from "react";

import { canvasEnvironment } from "~/state/canvas";

import ThreadCanvas from "./ThreadCanvas";
import { TraceView } from "./TraceView";

export default function ThreadTrace({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const result = useAtomValue(
    canvasEnvironment.canvas({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    }),
  );
  const [view, setView] = useState<{ mode: "steps" | "overview"; focusCardId: string | null }>({
    mode: "steps",
    focusCardId: null,
  });
  const canvas: ThreadCanvasState | null = AsyncResult.isSuccess(result) ? result.value : null;

  if (view.mode === "overview") {
    return (
      <div
        className="h-full"
        onKeyDown={(event) => {
          if (event.key === "Escape") setView((current) => ({ ...current, mode: "steps" }));
        }}
      >
        <ThreadCanvas
          threadRef={threadRef}
          onOpenCard={(cardId) => setView({ mode: "steps", focusCardId: cardId })}
        />
      </div>
    );
  }
  if (!canvas) return <div className="h-full bg-background" />;
  return (
    <TraceView
      environmentId={threadRef.environmentId}
      canvas={canvas}
      focusCardId={view.focusCardId}
      onOverview={() => setView((current) => ({ ...current, mode: "overview" }))}
    />
  );
}
