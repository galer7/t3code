/**
 * Draw-out canvas prototype: the server owns each thread's canvas. The agent's
 * `canvas_*` tools change it directly, so they work with no window open, and
 * every window subscribes to it. Each canvas is one JSON file in the state
 * directory.
 */
import {
  type CanvasCommand,
  type CanvasEdit,
  ThreadCanvasState,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SynchronizedRef from "effect/SynchronizedRef";

import { writeFileStringAtomically } from "../atomicWrite.ts";
import { ServerConfig } from "../config.ts";

export class CanvasCardNotFoundError extends Schema.TaggedError<CanvasCardNotFoundError>()(
  "CanvasCardNotFoundError",
  { cardId: Schema.String, known: Schema.String },
) {
  override get message(): string {
    return `No card ${this.cardId} on this canvas. Card ids: ${this.known}.`;
  }
}

export type CanvasCommandResult =
  | { readonly cardId: string }
  | { readonly arrowId: string }
  | { readonly removedCards: number };

export class CanvasStore extends Context.Service<
  CanvasStore,
  {
    readonly get: (threadId: ThreadId) => Effect.Effect<ThreadCanvasState>;
    /** The canvas now, then after every change. */
    readonly subscribe: (threadId: ThreadId) => Stream.Stream<ThreadCanvasState>;
    /** Applies an agent's tool call. */
    readonly apply: (
      threadId: ThreadId,
      command: CanvasCommand,
    ) => Effect.Effect<CanvasCommandResult, CanvasCardNotFoundError>;
    /** Applies a change the user made. An edit of a missing card does nothing. */
    readonly edit: (threadId: ThreadId, edit: CanvasEdit) => Effect.Effect<ThreadCanvasState>;
  }
>()("t3/canvas/CanvasStore") {}

const emptyCanvas = (threadId: ThreadId): ThreadCanvasState => ({
  threadId,
  cards: [],
  arrows: [],
  pinned: {},
  nextCard: 1,
  nextArrow: 1,
  revision: 0,
});

const cardIds = (canvas: ThreadCanvasState) =>
  canvas.cards.length === 0 ? "none yet" : canvas.cards.map((card) => card.id).join(", ");

const requireCard = (canvas: ThreadCanvasState, cardId: string) =>
  canvas.cards.some((card) => card.id === cardId)
    ? Effect.void
    : Effect.fail(new CanvasCardNotFoundError({ cardId, known: cardIds(canvas) }));

/** The next canvas and the tool's result for an agent's command. */
const applyCommand = (
  canvas: ThreadCanvasState,
  command: CanvasCommand,
): Effect.Effect<readonly [CanvasCommandResult, ThreadCanvasState], CanvasCardNotFoundError> =>
  Effect.gen(function* () {
    switch (command.type) {
      case "showCode": {
        if (command.after !== undefined) yield* requireCard(canvas, command.after);
        const same = canvas.cards.find(
          (card) =>
            card.path === command.path &&
            card.startLine === command.startLine &&
            card.endLine === command.endLine,
        );
        if (same) {
          const cards = canvas.cards.map((card) =>
            card.id === same.id
              ? {
                  ...card,
                  title: command.title ?? card.title,
                  caption: command.caption ?? card.caption,
                }
              : card,
          );
          return [{ cardId: same.id }, { ...canvas, cards }] as const;
        }
        const id = `c${canvas.nextCard}`;
        const card = {
          id,
          path: command.path,
          startLine: command.startLine,
          endLine: command.endLine,
          lane: command.lane ?? "backend",
          title: command.title ?? null,
          caption: command.caption ?? null,
          after: command.after ?? null,
        };
        return [
          { cardId: id },
          { ...canvas, cards: [...canvas.cards, card], nextCard: canvas.nextCard + 1 },
        ] as const;
      }
      case "connect": {
        yield* requireCard(canvas, command.from);
        yield* requireCard(canvas, command.to);
        const same = canvas.arrows.find(
          (arrow) => arrow.from === command.from && arrow.to === command.to,
        );
        if (same) {
          const arrows = canvas.arrows.map((arrow) =>
            arrow.id === same.id ? { ...arrow, label: command.label ?? arrow.label } : arrow,
          );
          return [{ arrowId: same.id }, { ...canvas, arrows }] as const;
        }
        const id = `a${canvas.nextArrow}`;
        const arrow = { id, from: command.from, to: command.to, label: command.label ?? null };
        return [
          { arrowId: id },
          { ...canvas, arrows: [...canvas.arrows, arrow], nextArrow: canvas.nextArrow + 1 },
        ] as const;
      }
      case "clear":
        return [
          { removedCards: canvas.cards.length },
          { ...canvas, cards: [], arrows: [], pinned: {} },
        ] as const;
    }
  });

const applyEdit = (canvas: ThreadCanvasState, edit: CanvasEdit): ThreadCanvasState => {
  switch (edit.type) {
    case "pin":
      return canvas.cards.some((card) => card.id === edit.cardId)
        ? { ...canvas, pinned: { ...canvas.pinned, [edit.cardId]: { x: edit.x, y: edit.y } } }
        : canvas;
    case "unpinAll":
      return { ...canvas, pinned: {} };
    case "remove": {
      const { [edit.cardId]: _removed, ...pinned } = canvas.pinned;
      return {
        ...canvas,
        cards: canvas.cards
          .filter((card) => card.id !== edit.cardId)
          .map((card) => (card.after === edit.cardId ? { ...card, after: null } : card)),
        arrows: canvas.arrows.filter(
          (arrow) => arrow.from !== edit.cardId && arrow.to !== edit.cardId,
        ),
        pinned,
      };
    }
    case "clear":
      return { ...canvas, cards: [], arrows: [], pinned: {} };
  }
};

const decodeCanvas = Schema.decodeUnknownEffect(Schema.fromJsonString(ThreadCanvasState));
const encodeCanvas = Schema.encodeEffect(Schema.fromJsonString(ThreadCanvasState));

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = path.join(config.stateDir, "canvases");
  const canvases = yield* SynchronizedRef.make(new Map<ThreadId, ThreadCanvasState>());
  const changes = yield* PubSub.unbounded<ThreadCanvasState>();

  const fileOf = (threadId: ThreadId) =>
    path.join(directory, `${encodeURIComponent(threadId)}.json`);

  const load = (threadId: ThreadId) =>
    fs.readFileString(fileOf(threadId)).pipe(
      Effect.flatMap(decodeCanvas),
      Effect.orElseSucceed(() => emptyCanvas(threadId)),
    );

  /** Runs `change` on the thread's canvas; a changed canvas is saved and published. */
  const update = <A, E>(
    threadId: ThreadId,
    change: (canvas: ThreadCanvasState) => Effect.Effect<readonly [A, ThreadCanvasState], E>,
  ) =>
    SynchronizedRef.modifyEffect(canvases, (current) =>
      Effect.gen(function* () {
        const canvas = current.get(threadId) ?? (yield* load(threadId));
        const [result, changed] = yield* change(canvas);
        if (changed === canvas) {
          const next = new Map(current).set(threadId, canvas);
          return [[result, canvas] as const, next] as const;
        }
        const saved = { ...changed, revision: canvas.revision + 1 };
        yield* encodeCanvas(saved).pipe(
          Effect.flatMap((contents) =>
            writeFileStringAtomically({ filePath: fileOf(threadId), contents }),
          ),
          Effect.catchCause((cause) =>
            Effect.logWarning("Draw-out could not save a canvas", { threadId, cause }),
          ),
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
        );
        yield* PubSub.publish(changes, saved);
        return [[result, saved] as const, new Map(current).set(threadId, saved)] as const;
      }),
    );

  const get = (threadId: ThreadId) =>
    update(threadId, (canvas) => Effect.succeed([undefined, canvas] as const)).pipe(
      Effect.map(([, canvas]) => canvas),
    );

  return CanvasStore.of({
    get,
    subscribe: (threadId) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const subscription = yield* PubSub.subscribe(changes);
          const current = yield* get(threadId);
          return Stream.concat(
            Stream.make(current),
            Stream.fromSubscription(subscription).pipe(
              Stream.filter((canvas) => canvas.threadId === threadId),
            ),
          );
        }),
      ),
    apply: (threadId, command) =>
      update(threadId, (canvas) => applyCommand(canvas, command)).pipe(
        Effect.map(([result]) => result),
      ),
    edit: (threadId, edit) =>
      update(threadId, (canvas) =>
        Effect.succeed([undefined, applyEdit(canvas, edit)] as const),
      ).pipe(Effect.map(([, canvas]) => canvas)),
  });
});

export const layer = Layer.effect(CanvasStore, make);
