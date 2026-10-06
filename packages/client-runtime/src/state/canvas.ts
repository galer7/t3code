/**
 * Draw-out canvas prototype: each thread's canvas lives on the server. A
 * window subscribes to it and sends the user's edits.
 */
import { WS_METHODS } from "@t3tools/contracts";
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
