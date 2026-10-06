/**
 * Draw-out canvas prototype: each thread's canvas lives on the server. A
 * window subscribes to it and sends the user's edits.
 */
import { WS_METHODS } from "@t3tools/contracts";
import * as Stream from "effect/Stream";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

export function createCanvasEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    canvas: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:canvas:subscribe",
      tag: WS_METHODS.canvasSubscribe,
    }),
    /** One language server per stream; it stops when the stream is dropped. */
    lspConnect: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:lsp:connect",
      tag: WS_METHODS.lspConnect,
      idleTtlMs: 0,
      // An atom keeps only the last item of each chunk. LSP needs every
      // message, so each chunk becomes one batch.
      transform: (stream) => stream.pipe(Stream.mapArray((events) => [events] as const)),
    }),
    lspSend: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:lsp:send",
      tag: WS_METHODS.lspSend,
      scheduler: createAtomCommandScheduler(),
      concurrency: {
        mode: "serial",
        key: ({ environmentId, input }) => JSON.stringify([environmentId, input.sessionId]),
      },
    }),
    edit: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:canvas:edit",
      tag: WS_METHODS.canvasEdit,
      scheduler: createAtomCommandScheduler(),
      concurrency: {
        mode: "serial",
        key: ({ environmentId, input }) => JSON.stringify([environmentId, input.threadId]),
      },
    }),
  };
}
