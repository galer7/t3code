/**
 * Draw-out: a thread's trace. The map by default; the step view walks the
 * same cards one at a time, and Esc there goes back to the map.
 */
import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef, ThreadCanvasState } from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback, useState } from "react";

import { canvasEnvironment } from "~/state/canvas";

import { MapView } from "./MapView";
import { TraceView } from "./TraceView";

export default function ThreadTrace({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const result = useAtomValue(
    canvasEnvironment.canvas({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    }),
  );
  const [mode, setMode] = useState<"map" | "steps">("map");
  const [focusCardId, setFocusCardId] = useState<string | null>(null);
  const onCardChange = useCallback(() => {}, []);
  const canvas: ThreadCanvasState | null = AsyncResult.isSuccess(result) ? result.value : null;

  if (!canvas) return <div className="h-full bg-background" />;
  if (mode === "map") {
    return (
      <MapView
        key={threadRef.threadId}
        environmentId={threadRef.environmentId}
        canvas={canvas}
        onSteps={(cardId) => {
          setFocusCardId(cardId);
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
      onOverview={() => setMode("map")}
      onCardChange={onCardChange}
    />
  );
}
