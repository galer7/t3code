/**
 * Draw-out: a link from the chat to a card. The agent writes
 * `[UploadsController#create](t3-card:c3)`; the chat shows it as a chip, and a
 * click shows that card's trace beside the chat and scrolls to the card.
 */
import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef, ThreadCanvasState } from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import type { ReactNode } from "react";

import { canvasEnvironment } from "~/state/canvas";

import { LANE_STYLES } from "./laneStyles";

export const CARD_REF_PROTOCOL = "t3-card";

/** The card id of a `t3-card:` link, or null for any other link. */
export function parseCardRefHref(href: string): string | null {
  const match = /^t3-card:(?:\/\/)?([A-Za-z0-9_-]{1,128})$/.exec(href.trim());
  return match ? match[1]! : null;
}

export interface CardReveal {
  readonly threadId: string;
  readonly cardId: string;
  readonly at: number;
}

const REVEAL_EVENT = "drawout:reveal-card";
/** The last request, so a trace pane that opens because of it can still answer it. */
let lastReveal: CardReveal | null = null;

export function revealCard(threadId: string, cardId: string) {
  lastReveal = { threadId, cardId, at: Date.now() };
  window.dispatchEvent(new CustomEvent<CardReveal>(REVEAL_EVENT, { detail: lastReveal }));
}

/** Calls `onReveal` for each request, and once for a request made just before. */
export function onCardReveal(onReveal: (reveal: CardReveal) => void): () => void {
  if (lastReveal && Date.now() - lastReveal.at < 2000) onReveal(lastReveal);
  const listener = (event: Event) => onReveal((event as CustomEvent<CardReveal>).detail);
  window.addEventListener(REVEAL_EVENT, listener);
  return () => window.removeEventListener(REVEAL_EVENT, listener);
}

export function CardRefChip(props: {
  readonly threadRef: ScopedThreadRef | undefined;
  readonly cardId: string;
  readonly children: ReactNode;
}) {
  const { threadRef, cardId } = props;
  if (!threadRef) return <span>{props.children}</span>;
  return (
    <CardRefButton threadRef={threadRef} cardId={cardId}>
      {props.children}
    </CardRefButton>
  );
}

function CardRefButton(props: {
  readonly threadRef: ScopedThreadRef;
  readonly cardId: string;
  readonly children: ReactNode;
}) {
  const { threadRef, cardId } = props;
  const result = useAtomValue(
    canvasEnvironment.canvas({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    }),
  );
  const canvas: ThreadCanvasState | null =
    result && AsyncResult.isSuccess(result) ? result.value : null;
  const card = canvas?.cards.find((other) => other.id === cardId) ?? null;
  const color = card ? LANE_STYLES[card.lane].color : "var(--muted-foreground)";
  return (
    <button
      type="button"
      onClick={() => revealCard(threadRef.threadId, cardId)}
      disabled={!card}
      title={card ? `Show ${card.title ?? card.path} in the trace` : "This card is gone"}
      className="drawout-card-ref"
      style={{ "--lane": color } as React.CSSProperties}
    >
      {props.children}
    </button>
  );
}
