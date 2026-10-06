/**
 * Draw-out canvas prototype: a browser editor talks to a language server on
 * the server's machine. The server finds the project root of a file, starts
 * the language's server there, and pipes LSP messages both ways.
 */
import { Schema } from "effect";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const LspConnectInput = Schema.Struct({
  /** Any file of the project: the server walks up from it to the project root. */
  path: TrimmedNonEmptyString,
  /** The Monaco language id, such as `ruby` or `typescript`. */
  languageId: TrimmedNonEmptyString,
});
export type LspConnectInput = typeof LspConnectInput.Type;

export const LspStreamEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("ready"),
    sessionId: TrimmedNonEmptyString,
    rootPath: TrimmedNonEmptyString,
    server: Schema.String,
  }),
  Schema.Struct({ type: Schema.Literal("message"), message: Schema.Unknown }),
  /** No language server for this language or root; the editor works without one. */
  Schema.Struct({ type: Schema.Literal("unavailable"), reason: Schema.String }),
  Schema.Struct({ type: Schema.Literal("exited"), code: Schema.NullOr(Schema.Int) }),
]);
export type LspStreamEvent = typeof LspStreamEvent.Type;

export const LspSendInput = Schema.Struct({
  sessionId: TrimmedNonEmptyString,
  message: Schema.Unknown,
});
export type LspSendInput = typeof LspSendInput.Type;
