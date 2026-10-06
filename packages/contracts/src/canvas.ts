/**
 * Draw-out: the canvas-host protocol.
 *
 * Each thread has one canvas in Draw-out. The agent's `canvas_*` MCP tools
 * reach it through a canvas host: a Draw-out window connected to this server.
 * The host opens a stream, receives one request per tool call (with the
 * calling thread's id), applies it to that thread's canvas, and answers with
 * `canvasHost.respond`.
 */
import { Schema } from "effect";

import { EnvironmentId, PositiveInt, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const CanvasHostClientId = TrimmedNonEmptyString.check(Schema.isMaxLength(128));
export type CanvasHostClientId = typeof CanvasHostClientId.Type;
export const CanvasHostConnectionId = TrimmedNonEmptyString.check(Schema.isMaxLength(64));
export type CanvasHostConnectionId = typeof CanvasHostConnectionId.Type;
export const CanvasCardId = TrimmedNonEmptyString.check(Schema.isMaxLength(128));
export type CanvasCardId = typeof CanvasCardId.Type;

export const CanvasHost = Schema.Struct({
  clientId: CanvasHostClientId,
  /** The host receives only requests from threads of this environment. */
  environmentId: EnvironmentId,
});
export type CanvasHost = typeof CanvasHost.Type;

/** The lanes of a canvas, left to right. External services are always last. */
export const CanvasLane = Schema.Literals(["frontend", "backend", "infra", "external"]);
export type CanvasLane = typeof CanvasLane.Type;

/** Show lines `startLine`..`endLine` (1-based, inclusive) of an absolute file path as a card. */
export const CanvasShowCodeCommand = Schema.Struct({
  type: Schema.Literal("showCode"),
  path: TrimmedNonEmptyString,
  startLine: PositiveInt,
  endLine: PositiveInt,
  /** Draw-out puts a card with no lane in the backend lane. */
  lane: Schema.optional(CanvasLane),
  /** A short name for the card, such as `UploadsController#create`. */
  title: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(80))),
  /** One sentence on why this code matters to the question. */
  caption: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(280))),
  /** Place the card next to this card, which it follows in the flow. */
  after: Schema.optional(CanvasCardId),
});
export type CanvasShowCodeCommand = typeof CanvasShowCodeCommand.Type;

/** Draw an arrow from one card to another: the flow goes from `from` to `to`. */
export const CanvasConnectCommand = Schema.Struct({
  type: Schema.Literal("connect"),
  from: CanvasCardId,
  to: CanvasCardId,
  /** What happens along the arrow, such as `POST /uploads` or `enqueues`. */
  label: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(60))),
});
export type CanvasConnectCommand = typeof CanvasConnectCommand.Type;

/** Remove every card and arrow from the thread's canvas. */
export const CanvasClearCommand = Schema.Struct({
  type: Schema.Literal("clear"),
});
export type CanvasClearCommand = typeof CanvasClearCommand.Type;

export const CanvasCommand = Schema.Union([
  CanvasShowCodeCommand,
  CanvasConnectCommand,
  CanvasClearCommand,
]);
export type CanvasCommand = typeof CanvasCommand.Type;

export const CanvasShowCodeResult = Schema.Struct({
  cardId: CanvasCardId,
});
export type CanvasShowCodeResult = typeof CanvasShowCodeResult.Type;

export const CanvasConnectResult = Schema.Struct({
  arrowId: TrimmedNonEmptyString,
});
export type CanvasConnectResult = typeof CanvasConnectResult.Type;

export const CanvasClearResult = Schema.Struct({
  removedCards: Schema.Int,
});
export type CanvasClearResult = typeof CanvasClearResult.Type;

export const CanvasHostRequest = Schema.Struct({
  requestId: TrimmedNonEmptyString,
  /** The thread whose canvas the command changes. */
  threadId: ThreadId,
  command: CanvasCommand,
  timeoutMs: Schema.Int.check(Schema.isGreaterThan(0)),
});
export type CanvasHostRequest = typeof CanvasHostRequest.Type;

export const CanvasHostStreamEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("connected"),
    connectionId: CanvasHostConnectionId,
  }),
  Schema.Struct({
    type: Schema.Literal("request"),
    connectionId: CanvasHostConnectionId,
    request: CanvasHostRequest,
  }),
]);
export type CanvasHostStreamEvent = typeof CanvasHostStreamEvent.Type;

export const CanvasHostResponse = Schema.Struct({
  clientId: CanvasHostClientId,
  connectionId: CanvasHostConnectionId,
  requestId: TrimmedNonEmptyString,
  ok: Schema.Boolean,
  result: Schema.optional(Schema.Unknown),
  /** Why the host could not apply the command. The agent reads it. */
  error: Schema.optional(Schema.Struct({ message: Schema.String })),
});
export type CanvasHostResponse = typeof CanvasHostResponse.Type;

/**
 * Draw-out canvas prototype: the server owns each thread's canvas. The agent's
 * tools change it with no window open; every window subscribes to it.
 */
export const CanvasCardRecord = Schema.Struct({
  id: CanvasCardId,
  /** Absolute path on the server's machine. */
  path: TrimmedNonEmptyString,
  startLine: PositiveInt,
  endLine: PositiveInt,
  lane: CanvasLane,
  title: Schema.NullOr(Schema.String),
  caption: Schema.NullOr(Schema.String),
  /** The card this one follows in the flow. */
  after: Schema.NullOr(CanvasCardId),
});
export type CanvasCardRecord = typeof CanvasCardRecord.Type;

export const CanvasArrowRecord = Schema.Struct({
  id: TrimmedNonEmptyString,
  from: CanvasCardId,
  to: CanvasCardId,
  label: Schema.NullOr(Schema.String),
});
export type CanvasArrowRecord = typeof CanvasArrowRecord.Type;

export const CanvasPoint = Schema.Struct({ x: Schema.Number, y: Schema.Number });
export type CanvasPoint = typeof CanvasPoint.Type;

export const ThreadCanvasState = Schema.Struct({
  threadId: ThreadId,
  cards: Schema.Array(CanvasCardRecord),
  arrows: Schema.Array(CanvasArrowRecord),
  /** Where the user dropped a card. A pinned card keeps its place. */
  pinned: Schema.Record(Schema.String, CanvasPoint),
  nextCard: Schema.Int,
  nextArrow: Schema.Int,
  revision: Schema.Int,
});
export type ThreadCanvasState = typeof ThreadCanvasState.Type;

/** A change the user makes on the canvas. */
export const CanvasEdit = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("pin"),
    cardId: CanvasCardId,
    x: Schema.Number,
    y: Schema.Number,
  }),
  Schema.Struct({ type: Schema.Literal("unpinAll") }),
  Schema.Struct({ type: Schema.Literal("remove"), cardId: CanvasCardId }),
  Schema.Struct({ type: Schema.Literal("clear") }),
]);
export type CanvasEdit = typeof CanvasEdit.Type;

export const CanvasSubscribeInput = Schema.Struct({ threadId: ThreadId });
export type CanvasSubscribeInput = typeof CanvasSubscribeInput.Type;

export const CanvasEditInput = Schema.Struct({ threadId: ThreadId, edit: CanvasEdit });
export type CanvasEditInput = typeof CanvasEditInput.Type;
