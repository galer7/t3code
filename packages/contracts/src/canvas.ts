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

/** Show lines `startLine`..`endLine` (1-based, inclusive) of an absolute file path as a card. */
export const CanvasShowCodeCommand = Schema.Struct({
  type: Schema.Literal("showCode"),
  path: TrimmedNonEmptyString,
  startLine: PositiveInt,
  endLine: PositiveInt,
});
export type CanvasShowCodeCommand = typeof CanvasShowCodeCommand.Type;

export const CanvasCommand = Schema.Union([CanvasShowCodeCommand]);
export type CanvasCommand = typeof CanvasCommand.Type;

export const CanvasShowCodeResult = Schema.Struct({
  cardId: CanvasCardId,
});
export type CanvasShowCodeResult = typeof CanvasShowCodeResult.Type;

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
