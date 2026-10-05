/**
 * Draw-out: the `canvas_*` tools. Each call changes the canvas of the thread
 * that holds the MCP token, through a connected canvas host (a Draw-out window).
 */
import {
  CanvasCardId,
  CanvasLane,
  CanvasShowCodeResult,
  CanvasSuggestLayoutResult,
  McpCapabilityUnavailableError,
  PositiveInt,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Tool from "effect/unstable/ai/Tool";
import * as Toolkit from "effect/unstable/ai/Toolkit";

import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as CanvasHostBroker from "../../CanvasHostBroker.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  CanvasHostBroker.CanvasHostBroker,
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
});
export type CanvasShowCodeInput = typeof CanvasShowCodeInput.Type;

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
  CanvasHostBroker.CanvasHostError,
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

export const CanvasSuggestLayoutInput = Schema.Struct({
  cards: Schema.Array(
    Schema.Struct({
      cardId: CanvasCardId.annotate({ description: "A card id that canvas_show_code returned." }),
      lane: CanvasLane,
    }),
  )
    .check(Schema.isMinLength(1))
    .annotate({
      description:
        "Cards in the order the code runs. Each goes to its lane, in this order within the lane; cards you leave out keep their place after them.",
    }),
});
export type CanvasSuggestLayoutInput = typeof CanvasSuggestLayoutInput.Type;

export const CanvasSuggestLayoutTool = Tool.make("canvas_suggest_layout", {
  description:
    "Rearrange cards on this thread's canvas in Draw-out: put each card in its lane, in execution order. Cards the user dragged stay where they are until the user accepts your layout. Returns how many cards moved and how many wait for the user.",
  parameters: CanvasSuggestLayoutInput,
  success: CanvasSuggestLayoutResult,
  failure: CanvasToolError,
  dependencies,
})
  .annotate(Tool.Title, "Suggest a canvas layout")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const CanvasToolkit = Toolkit.make(CanvasShowCodeTool, CanvasSuggestLayoutTool);
