/**
 * Draw-out canvas prototype: the server owns each thread's traces. The agent's
 * `trace_*` tools change them directly, so they work with no window open, and
 * every window subscribes. A thread's traces, cards and marks are one JSON
 * file in the state directory.
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

export class CanvasTraceNotFoundError extends Schema.TaggedError<CanvasTraceNotFoundError>()(
  "CanvasTraceNotFoundError",
  { traceId: Schema.String, known: Schema.String },
) {
  override get message(): string {
    return `No trace ${this.traceId} in this thread. Trace ids: ${this.known}.`;
  }
}

export class CanvasMarkNotFoundError extends Schema.TaggedError<CanvasMarkNotFoundError>()(
  "CanvasMarkNotFoundError",
  { markId: Schema.String, known: Schema.String },
) {
  override get message(): string {
    return `No mark ${this.markId} in this thread. Mark ids: ${this.known}.`;
  }
}

export class CanvasEditRangeError extends Schema.TaggedError<CanvasEditRangeError>()(
  "CanvasEditRangeError",
  { startLine: Schema.Int, endLine: Schema.Int },
) {
  override get message(): string {
    return `The edit leaves endLine ${this.endLine} before startLine ${this.startLine}. Pass both lines.`;
  }
}

export type CanvasStoreError =
  | CanvasCardNotFoundError
  | CanvasTraceNotFoundError
  | CanvasMarkNotFoundError
  | CanvasEditRangeError;

export type CanvasCommandResult =
  | { readonly cardId: string; readonly traceId: string }
  | { readonly traceId: string }
  | { readonly markId: string }
  | { readonly done: string };

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
    ) => Effect.Effect<CanvasCommandResult, CanvasStoreError>;
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
  traces: [],
  currentTrace: null,
  marks: [],
  nextTrace: 1,
  nextMark: 1,
});

/** A canvas with every trace field set. Cards saved before traces join one trace. */
const normalize = (canvas: ThreadCanvasState): ThreadCanvasState => {
  const loose = canvas.cards.some((card) => card.trace === undefined);
  const traces = [...(canvas.traces ?? [])];
  let nextTrace = canvas.nextTrace ?? traces.length + 1;
  let currentTrace = canvas.currentTrace ?? traces.at(-1)?.id ?? null;
  let cards = canvas.cards;
  if (loose) {
    const id = `t${nextTrace}`;
    nextTrace += 1;
    traces.unshift({ id, title: "Trace 1" });
    currentTrace ??= id;
    cards = cards.map((card) => (card.trace === undefined ? { ...card, trace: id } : card));
  }
  return {
    ...canvas,
    cards,
    traces,
    currentTrace,
    marks: canvas.marks ?? [],
    nextTrace,
    nextMark: canvas.nextMark ?? 1,
  };
};

const traceIds = (canvas: ThreadCanvasState) =>
  (canvas.traces ?? []).length === 0
    ? "none yet"
    : (canvas.traces ?? []).map((trace) => trace.id).join(", ");

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
): Effect.Effect<readonly [CanvasCommandResult, ThreadCanvasState], CanvasStoreError> =>
  Effect.gen(function* () {
    switch (command.type) {
      case "showCode": {
        let next = canvas;
        let traceId = command.trace ?? canvas.currentTrace ?? null;
        if (traceId !== null && !(canvas.traces ?? []).some((trace) => trace.id === traceId)) {
          return yield* new CanvasTraceNotFoundError({ traceId, known: traceIds(canvas) });
        }
        if (traceId === null) {
          // The first card of a thread starts its first trace.
          traceId = `t${canvas.nextTrace ?? 1}`;
          next = {
            ...canvas,
            traces: [...(canvas.traces ?? []), { id: traceId, title: "Trace 1" }],
            nextTrace: (canvas.nextTrace ?? 1) + 1,
          };
        }
        const same = next.cards.find(
          (card) =>
            card.trace === traceId &&
            card.path === command.path &&
            card.startLine === command.startLine &&
            card.endLine === command.endLine,
        );
        if (same) {
          const cards = next.cards.map((card) =>
            card.id === same.id
              ? {
                  ...card,
                  title: command.title ?? card.title,
                  caption: command.caption ?? card.caption,
                }
              : card,
          );
          return [
            { cardId: same.id, traceId },
            { ...next, cards, currentTrace: traceId },
          ] as const;
        }
        const id = `c${next.nextCard}`;
        const card = {
          id,
          path: command.path,
          startLine: command.startLine,
          endLine: command.endLine,
          lane: command.lane ?? "backend",
          title: command.title ?? null,
          caption: command.caption ?? null,
          after: null,
          trace: traceId,
          ...(command.repo === undefined ? {} : { repo: command.repo }),
        };
        return [
          { cardId: id, traceId },
          {
            ...next,
            cards: [...next.cards, card],
            nextCard: next.nextCard + 1,
            currentTrace: traceId,
          },
        ] as const;
      }
      case "startTrace": {
        const id = `t${canvas.nextTrace ?? 1}`;
        return [
          { traceId: id },
          {
            ...canvas,
            traces: [...(canvas.traces ?? []), { id, title: command.title }],
            currentTrace: id,
            nextTrace: (canvas.nextTrace ?? 1) + 1,
          },
        ] as const;
      }
      case "mark": {
        yield* requireCard(canvas, command.cardId);
        const id = `m${canvas.nextMark ?? 1}`;
        const mark = {
          id,
          cardId: command.cardId,
          startLine: command.startLine,
          endLine: Math.max(command.startLine, command.endLine ?? command.startLine),
          text: command.text,
          tone: command.tone ?? "info",
        };
        return [
          { markId: id },
          {
            ...canvas,
            marks: [...(canvas.marks ?? []), mark],
            nextMark: (canvas.nextMark ?? 1) + 1,
          },
        ] as const;
      }
      case "editCard": {
        yield* requireCard(canvas, command.cardId);
        const card = canvas.cards.find((other) => other.id === command.cardId)!;
        if (command.remove) {
          return [
            { done: `removed card ${card.id}` },
            {
              ...canvas,
              cards: canvas.cards.filter((other) => other.id !== card.id),
              marks: (canvas.marks ?? []).filter((mark) => mark.cardId !== card.id),
            },
          ] as const;
        }
        const startLine = command.startLine ?? card.startLine;
        const endLine = command.endLine ?? card.endLine;
        if (endLine < startLine) return yield* new CanvasEditRangeError({ startLine, endLine });
        let changed = {
          ...card,
          path: command.path ?? card.path,
          ...(command.path === undefined
            ? {}
            : command.repo === undefined
              ? { repo: undefined }
              : { repo: command.repo }),
          startLine,
          endLine,
          lane: command.lane ?? card.lane,
          title: command.title ?? card.title,
          caption: command.caption ?? card.caption,
        };
        let cards = canvas.cards.map((other) => (other.id === card.id ? changed : other));
        if (command.moveBefore !== undefined) {
          const rest = cards.filter((other) => other.id !== card.id);
          if (command.moveBefore === "end") {
            cards = [...rest, changed];
          } else {
            if (command.moveBefore === card.id)
              return [{ done: "nothing to move" }, canvas] as const;
            yield* requireCard(canvas, command.moveBefore);
            const target = rest.find((other) => other.id === command.moveBefore)!;
            changed = { ...changed, trace: target.trace };
            const index = rest.indexOf(target);
            cards = [...rest.slice(0, index), changed, ...rest.slice(index)];
          }
        }
        return [{ done: `changed card ${card.id}` }, { ...canvas, cards }] as const;
      }
      case "renameTrace": {
        const traceId = command.trace ?? canvas.currentTrace ?? null;
        if (traceId === null || !(canvas.traces ?? []).some((trace) => trace.id === traceId)) {
          return yield* new CanvasTraceNotFoundError({
            traceId: traceId ?? "(none)",
            known: traceIds(canvas),
          });
        }
        return [
          { done: `renamed trace ${traceId}` },
          {
            ...canvas,
            traces: (canvas.traces ?? []).map((trace) =>
              trace.id === traceId ? { ...trace, title: command.title } : trace,
            ),
          },
        ] as const;
      }
      case "editMark": {
        const marks = canvas.marks ?? [];
        const mark = marks.find((other) => other.id === command.markId);
        if (!mark) {
          return yield* new CanvasMarkNotFoundError({
            markId: command.markId,
            known: marks.length === 0 ? "none yet" : marks.map((other) => other.id).join(", "),
          });
        }
        if (command.remove) {
          return [
            { done: `removed mark ${mark.id}` },
            { ...canvas, marks: marks.filter((other) => other.id !== mark.id) },
          ] as const;
        }
        const startLine = command.startLine ?? mark.startLine;
        const endLine = command.endLine ?? Math.max(startLine, mark.endLine);
        if (endLine < startLine) return yield* new CanvasEditRangeError({ startLine, endLine });
        const changed = {
          ...mark,
          startLine,
          endLine,
          text: command.text ?? mark.text,
          tone: command.tone ?? mark.tone,
        };
        return [
          { done: `changed mark ${mark.id}` },
          { ...canvas, marks: marks.map((other) => (other.id === mark.id ? changed : other)) },
        ] as const;
      }
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
    case "removeTrace": {
      const traces = (canvas.traces ?? []).filter((trace) => trace.id !== edit.traceId);
      if (traces.length === (canvas.traces ?? []).length) return canvas;
      const gone = new Set(
        canvas.cards.filter((card) => card.trace === edit.traceId).map((card) => card.id),
      );
      return {
        ...canvas,
        traces,
        currentTrace:
          canvas.currentTrace === edit.traceId
            ? (traces.at(-1)?.id ?? null)
            : (canvas.currentTrace ?? null),
        cards: canvas.cards.filter((card) => !gone.has(card.id)),
        marks: (canvas.marks ?? []).filter((mark) => !gone.has(mark.cardId)),
      };
    }
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
      Effect.map(normalize),
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
