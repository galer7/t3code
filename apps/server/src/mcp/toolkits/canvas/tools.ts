/**
 * Draw-out: the `trace_*` tools. Each call changes the traces of the thread
 * that holds the MCP token. The server owns them; windows subscribe.
 */
import {
  CanvasCardId,
  CanvasClearResult,
  CanvasLane,
  CanvasMarkResult,
  CanvasMarkTone,
  CanvasShowCodeResult,
  CanvasStartTraceResult,
  CanvasTraceId,
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
        "The layer the code belongs to, which sets the card's colour: frontend, backend, infra, or external (a third-party service such as Zoom or Stripe, or the code that calls it). Default: backend.",
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
  trace: Schema.optional(
    CanvasTraceId.annotate({
      description:
        "The trace the card joins, by the id trace_start or trace_show_code returned. Default: the current trace, which is the one you last started or added to.",
    }),
  ),
});
export type CanvasShowCodeInput = typeof CanvasShowCodeInput.Type;

export const CanvasStartTraceInput = Schema.Struct({
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(80)).annotate({
    description:
      "What the trace shows, in a few words, such as `Checkout payment` or `Zoom cancel webhook`.",
  }),
});
export type CanvasStartTraceInput = typeof CanvasStartTraceInput.Type;

export const CanvasMarkInput = Schema.Struct({
  cardId: CanvasCardId.annotate({ description: "The card whose file the mark is on." }),
  startLine: PositiveInt.annotate({ description: "First line of the mark, 1-based, in the file." }),
  endLine: Schema.optional(
    PositiveInt.annotate({ description: "Last line of the mark, inclusive. Default: startLine." }),
  ),
  text: TrimmedNonEmptyString.check(Schema.isMaxLength(600)).annotate({
    description:
      "The note, in one or two short sentences. It shows as a comment above the lines, with the full text on hover.",
  }),
  tone: Schema.optional(
    CanvasMarkTone.annotate({
      description:
        "finding: something you found, such as a bug or the cause; claim: something you believe but did not prove; info: context. Default: info.",
    }),
  ),
});
export type CanvasMarkInput = typeof CanvasMarkInput.Type;

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
  CanvasStore.CanvasTraceNotFoundError,
]);
export type CanvasToolError = typeof CanvasToolError.Type;

export const CanvasShowCodeTool = Tool.make("trace_show_code", {
  description:
    "Show a range of code as a card in a trace beside this thread's chat, so the user sees the code you talk about. Cards show in the order you add them. Returns the card id and its trace id.",
  parameters: CanvasShowCodeInput,
  success: CanvasShowCodeResult,
  failure: CanvasToolError,
  dependencies,
})
  .annotate(Tool.Title, "Show code in a trace")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const CanvasStartTraceTool = Tool.make("trace_start", {
  description:
    "Start a new trace in this thread; it becomes the current trace, and the user sees it. Start one when the conversation moves to code that does not continue the current trace, or when the user asks. Returns the trace id.",
  parameters: CanvasStartTraceInput,
  success: CanvasStartTraceResult,
  failure: CanvasToolError,
  dependencies,
})
  .annotate(Tool.Title, "Start a trace")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const CanvasMarkTool = Tool.make("trace_mark", {
  description:
    "Put a note on lines of a card's file: why a line matters, what it calls, a finding. The user sees it as a comment above the lines. Returns the mark id.",
  parameters: CanvasMarkInput,
  success: CanvasMarkResult,
  failure: CanvasToolError,
  dependencies,
})
  .annotate(Tool.Title, "Mark lines in a trace")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const CanvasClearTool = Tool.make("trace_clear", {
  description:
    "Remove every card from the current trace. Use it only when the user asks for a fresh trace.",
  parameters: Tool.EmptyParams,
  success: CanvasClearResult,
  failure: CanvasToolError,
  dependencies,
})
  .annotate(Tool.Title, "Clear the current trace")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const CanvasToolkit = Toolkit.make(
  CanvasShowCodeTool,
  CanvasStartTraceTool,
  CanvasMarkTool,
  CanvasClearTool,
);
