/**
 * Draw-out: the `canvas_*` tools. Each call changes the canvas of the thread
 * that holds the MCP token. The server owns the canvas; windows subscribe to it.
 */
import {
  CanvasCardId,
  CanvasClearResult,
  CanvasConnectResult,
  CanvasLane,
  CanvasShowCodeResult,
  McpCapabilityUnavailableError,
  PositiveInt,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Tool from "effect/unstable/ai/Tool";
import * as Toolkit from "effect/unstable/ai/Toolkit";

import * as CanvasStore from "../../../canvas/CanvasStore.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  CanvasStore.CanvasStore,
  ProjectionSnapshotQuery.ProjectionSnapshotQuery,
];

export const CanvasShowCodeInput = Schema.Struct({
  path: TrimmedNonEmptyString.annotate({
    description:
      "The file to show: a path relative to this thread's workspace, or an absolute path.",
  }),
  startLine: PositiveInt.annotate({ description: "First line to show, 1-based." }),
  endLine: PositiveInt.annotate({
    description: "Last line to show, 1-based and inclusive. Not before startLine.",
  }),
  lane: Schema.optional(
    CanvasLane.annotate({
      description:
        "The layer the code belongs to; the canvas shows lanes left to right: frontend, backend, infra, then external (a third-party service such as Zoom or Stripe, or the code that calls it). Default: backend.",
    }),
  ),
  title: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(80)).annotate({
      description:
        "A short name for the card, such as `UploadsController#create` or `useUpload hook`. Default: the file name.",
    }),
  ),
  caption: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(280)).annotate({
      description: "One short sentence on why this code matters to the question.",
    }),
  ),
  after: Schema.optional(
    CanvasCardId.annotate({
      description:
        "The id of a card this code follows in the flow. The canvas places the new card beside it.",
    }),
  ),
});
export type CanvasShowCodeInput = typeof CanvasShowCodeInput.Type;

export const CanvasConnectInput = Schema.Struct({
  from: CanvasCardId.annotate({ description: "The card the flow starts from." }),
  to: CanvasCardId.annotate({ description: "The card the flow goes to." }),
  label: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(60)).annotate({
      description:
        "What happens along the arrow, in 1 to 4 words, such as `POST /uploads`, `enqueues`, `reads`, `webhook`.",
    }),
  ),
});
export type CanvasConnectInput = typeof CanvasConnectInput.Type;

export class CanvasRangeInvalidError extends Schema.TaggedError<CanvasRangeInvalidError>()(
  "CanvasRangeInvalidError",
  { startLine: Schema.Int, endLine: Schema.Int },
) {
  override get message(): string {
    return `endLine ${this.endLine} is before startLine ${this.startLine}. Pass a range whose endLine is at or after its startLine.`;
  }
}

export class CanvasThreadNotFoundError extends Schema.TaggedError<CanvasThreadNotFoundError>()(
  "CanvasThreadNotFoundError",
  { threadId: Schema.String },
) {
  override get message(): string {
    return `Thread ${this.threadId} was not found, so a relative path has no workspace. Pass an absolute path.`;
  }
}

export class CanvasThreadLookupError extends Schema.TaggedError<CanvasThreadLookupError>()(
  "CanvasThreadLookupError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not read this thread's workspace. Pass an absolute path.";
  }
}

export const CanvasToolError = Schema.Union([
  McpCapabilityUnavailableError,
  CanvasRangeInvalidError,
  CanvasThreadNotFoundError,
  CanvasThreadLookupError,
  CanvasStore.CanvasCardNotFoundError,
]);
export type CanvasToolError = typeof CanvasToolError.Type;

export const CanvasShowCodeTool = Tool.make("canvas_show_code", {
  description:
    "Show a range of code as a card on this thread's canvas in Draw-out, so the user sees the code you talk about. Use it when you read or explain code the user should look at. Returns the card id.",
  parameters: CanvasShowCodeInput,
  success: CanvasShowCodeResult,
  failure: CanvasToolError,
  dependencies,
})
  .annotate(Tool.Title, "Show code on the canvas")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const CanvasConnectTool = Tool.make("canvas_connect", {
  description:
    "Draw an arrow between two cards on this thread's canvas, so the user sees how the code flows: a call, a request, a job, an event, a read or write. Use the card ids canvas_show_code returned.",
  parameters: CanvasConnectInput,
  success: CanvasConnectResult,
  failure: CanvasToolError,
  dependencies,
})
  .annotate(Tool.Title, "Connect two cards on the canvas")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const CanvasClearTool = Tool.make("canvas_clear", {
  description:
    "Remove every card and arrow from this thread's canvas. Use it only when the user asks for a fresh canvas.",
  parameters: Tool.EmptyParams,
  success: CanvasClearResult,
  failure: CanvasToolError,
  dependencies,
})
  .annotate(Tool.Title, "Clear the canvas")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const CanvasToolkit = Toolkit.make(CanvasShowCodeTool, CanvasConnectTool, CanvasClearTool);
