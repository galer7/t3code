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
export const CanvasTraceId = TrimmedNonEmptyString.check(Schema.isMaxLength(128));
export type CanvasTraceId = typeof CanvasTraceId.Type;

/** How a mark reads: something the agent found, a claim to check, or plain context. */
export const CanvasMarkTone = Schema.Literals(["finding", "claim", "info"]);
export type CanvasMarkTone = typeof CanvasMarkTone.Type;

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
  /** The trace the card joins. Default: the current trace. */
  trace: Schema.optional(CanvasTraceId),
  /** The root of the git repo that holds the file, when there is one. */
  repo: Schema.optional(TrimmedNonEmptyString),
});
export type CanvasShowCodeCommand = typeof CanvasShowCodeCommand.Type;

/** Start a new trace; it becomes the current trace. */
export const CanvasStartTraceCommand = Schema.Struct({
  type: Schema.Literal("startTrace"),
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(80)),
});
export type CanvasStartTraceCommand = typeof CanvasStartTraceCommand.Type;

/** A note on lines of a card's file. */
export const CanvasMarkCommand = Schema.Struct({
  type: Schema.Literal("mark"),
  cardId: CanvasCardId,
  startLine: PositiveInt,
  endLine: Schema.optional(PositiveInt),
  text: TrimmedNonEmptyString.check(Schema.isMaxLength(600)),
  tone: Schema.optional(CanvasMarkTone),
});
export type CanvasMarkCommand = typeof CanvasMarkCommand.Type;

/** Change a card: its range, words or lane; move it; or remove it. */
export const CanvasEditCardCommand = Schema.Struct({
  type: Schema.Literal("editCard"),
  cardId: CanvasCardId,
  path: Schema.optional(TrimmedNonEmptyString),
  /** The git repo of a new `path`. */
  repo: Schema.optional(TrimmedNonEmptyString),
  startLine: Schema.optional(PositiveInt),
  endLine: Schema.optional(PositiveInt),
  lane: Schema.optional(CanvasLane),
  title: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(80))),
  caption: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(280))),
  /** Put the card before this card, which may be in another trace, or at the end of its trace. */
  moveBefore: Schema.optional(Schema.Union([CanvasCardId, Schema.Literal("end")])),
  remove: Schema.optional(Schema.Boolean),
});
export type CanvasEditCardCommand = typeof CanvasEditCardCommand.Type;

/** Give a trace a new title. Default: the current trace. */
export const CanvasRenameTraceCommand = Schema.Struct({
  type: Schema.Literal("renameTrace"),
  trace: Schema.optional(CanvasTraceId),
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(80)),
});
export type CanvasRenameTraceCommand = typeof CanvasRenameTraceCommand.Type;

/** Change a mark's lines, text or tone, or remove it. */
export const CanvasEditMarkCommand = Schema.Struct({
  type: Schema.Literal("editMark"),
  markId: TrimmedNonEmptyString,
  startLine: Schema.optional(PositiveInt),
  endLine: Schema.optional(PositiveInt),
  text: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(600))),
  tone: Schema.optional(CanvasMarkTone),
  remove: Schema.optional(Schema.Boolean),
});
export type CanvasEditMarkCommand = typeof CanvasEditMarkCommand.Type;

export const CanvasCommand = Schema.Union([
  CanvasShowCodeCommand,
  CanvasStartTraceCommand,
  CanvasMarkCommand,
  CanvasEditCardCommand,
  CanvasRenameTraceCommand,
  CanvasEditMarkCommand,
]);
export type CanvasCommand = typeof CanvasCommand.Type;

export const CanvasShowCodeResult = Schema.Struct({
  cardId: CanvasCardId,
  traceId: CanvasTraceId,
});
export type CanvasShowCodeResult = typeof CanvasShowCodeResult.Type;

export const CanvasStartTraceResult = Schema.Struct({
  traceId: CanvasTraceId,
});
export type CanvasStartTraceResult = typeof CanvasStartTraceResult.Type;

export const CanvasMarkResult = Schema.Struct({
  markId: TrimmedNonEmptyString,
});
export type CanvasMarkResult = typeof CanvasMarkResult.Type;

/** What an edit did, in a few words the agent reads. */
export const CanvasEditResult = Schema.Struct({
  done: Schema.String,
});
export type CanvasEditResult = typeof CanvasEditResult.Type;

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
  /** The trace the card belongs to. */
  trace: Schema.optional(CanvasTraceId),
  /** The root of the git repo that holds the file, so a trace can span repos. */
  repo: Schema.optional(Schema.String),
});
export type CanvasCardRecord = typeof CanvasCardRecord.Type;

export const CanvasTraceRecord = Schema.Struct({
  id: CanvasTraceId,
  title: Schema.String,
});
export type CanvasTraceRecord = typeof CanvasTraceRecord.Type;

export const CanvasMarkRecord = Schema.Struct({
  id: TrimmedNonEmptyString,
  cardId: CanvasCardId,
  startLine: PositiveInt,
  endLine: PositiveInt,
  text: Schema.String,
  tone: CanvasMarkTone,
});
export type CanvasMarkRecord = typeof CanvasMarkRecord.Type;

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
  /** The thread's traces, oldest first. A canvas saved before traces has none. */
  traces: Schema.optional(Schema.Array(CanvasTraceRecord)),
  /** The trace the agent's cards join. */
  currentTrace: Schema.optional(Schema.NullOr(CanvasTraceId)),
  marks: Schema.optional(Schema.Array(CanvasMarkRecord)),
  nextTrace: Schema.optional(Schema.Int),
  nextMark: Schema.optional(Schema.Int),
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
  /** Delete a trace with its cards and marks. Only the user deletes traces. */
  Schema.Struct({ type: Schema.Literal("removeTrace"), traceId: CanvasTraceId }),
]);
export type CanvasEdit = typeof CanvasEdit.Type;

export const CanvasSubscribeInput = Schema.Struct({ threadId: ThreadId });
export type CanvasSubscribeInput = typeof CanvasSubscribeInput.Type;

export const CanvasEditInput = Schema.Struct({ threadId: ThreadId, edit: CanvasEdit });
export type CanvasEditInput = typeof CanvasEditInput.Type;
