/**
 * Draw-out: sends each canvas tool call to a connected canvas host (a Draw-out
 * window) and waits for its answer. Built like the preview automation broker,
 * without tabs, focus or per-session leases: the newest host of the thread's
 * environment gets the request, and the request names the thread.
 */
import type {
  CanvasCommand,
  CanvasHost,
  CanvasHostResponse,
  CanvasHostStreamEvent,
} from "@t3tools/contracts";
import type * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SynchronizedRef from "effect/SynchronizedRef";

import * as McpInvocationContext from "./McpInvocationContext.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

/** Agents read these messages, so each names the next step and not only the failure. */
export class CanvasHostUnavailableError extends Schema.TaggedError<CanvasHostUnavailableError>()(
  "CanvasHostUnavailableError",
  { threadId: Schema.String, environmentId: Schema.String },
) {
  override get message(): string {
    return "No Draw-out window is connected to this server, so the canvas tools cannot show anything. Do not retry. Describe the code in text, or ask the user to open Draw-out.";
  }
}

export class CanvasHostTimeoutError extends Schema.TaggedError<CanvasHostTimeoutError>()(
  "CanvasHostTimeoutError",
  { threadId: Schema.String, requestId: Schema.String, timeoutMs: Schema.Int },
) {
  override get message(): string {
    return `The Draw-out window did not answer within ${this.timeoutMs}ms and was disconnected. Do not retry until the user reopens Draw-out.`;
  }
}

export class CanvasHostDisconnectedError extends Schema.TaggedError<CanvasHostDisconnectedError>()(
  "CanvasHostDisconnectedError",
  { threadId: Schema.String, requestId: Schema.String },
) {
  override get message(): string {
    return "The Draw-out window disconnected before it answered. The card may not be on the canvas.";
  }
}

export class CanvasHostRejectedError extends Schema.TaggedError<CanvasHostRejectedError>()(
  "CanvasHostRejectedError",
  { threadId: Schema.String, requestId: Schema.String, reason: Schema.String },
) {
  override get message(): string {
    return `Draw-out could not apply the request: ${this.reason}`;
  }
}

export const CanvasHostError = Schema.Union([
  CanvasHostUnavailableError,
  CanvasHostTimeoutError,
  CanvasHostDisconnectedError,
  CanvasHostRejectedError,
]);
export type CanvasHostError = typeof CanvasHostError.Type;

export interface CanvasHostInvokeInput {
  readonly scope: McpInvocationContext.McpInvocationScope;
  readonly command: CanvasCommand;
  readonly timeoutMs?: number;
}

export class CanvasHostBroker extends Context.Service<
  CanvasHostBroker,
  {
    readonly connect: (host: CanvasHost) => Effect.Effect<Stream.Stream<CanvasHostStreamEvent>>;
    readonly respond: (response: CanvasHostResponse) => Effect.Effect<void>;
    /** Sends the command to a host of the scope's environment and returns its result. */
    readonly invoke: (input: CanvasHostInvokeInput) => Effect.Effect<unknown, CanvasHostError>;
  }
>()("t3/mcp/CanvasHostBroker") {}

type HostQueue = Queue.Queue<CanvasHostStreamEvent, Cause.Done>;

interface HostConnection {
  readonly clientId: string;
  readonly connectionId: string;
  readonly environmentId: CanvasHost["environmentId"];
  /** Newer connections win: the window the user opened last. */
  readonly order: number;
  readonly queue: HostQueue;
}

interface PendingRequest {
  readonly queue: HostQueue;
  readonly clientId: string;
  readonly connectionId: string;
  readonly threadId: string;
  readonly deferred: Deferred.Deferred<unknown, CanvasHostError>;
}

interface BrokerState {
  readonly hosts: ReadonlyMap<string, HostConnection>;
  readonly pending: ReadonlyMap<string, PendingRequest>;
  readonly sequence: number;
}

/** Drops a host's generation and hands back the requests it can no longer answer. */
const removeHost = (current: BrokerState, clientId: string, queue: HostQueue) => {
  const hosts = new Map(current.hosts);
  if (hosts.get(clientId)?.queue === queue) hosts.delete(clientId);
  const pending = new Map(current.pending);
  const orphaned: Array<[string, PendingRequest]> = [];
  for (const [requestId, entry] of pending) {
    if (entry.queue !== queue) continue;
    pending.delete(requestId);
    orphaned.push([requestId, entry]);
  }
  return { state: { ...current, hosts, pending }, orphaned };
};

export const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const state = yield* SynchronizedRef.make<BrokerState>({
    hosts: new Map(),
    pending: new Map(),
    sequence: 0,
  });

  const failOrphaned = (orphaned: ReadonlyArray<[string, PendingRequest]>) =>
    Effect.forEach(
      orphaned,
      ([requestId, { deferred, threadId }]) =>
        Deferred.fail(deferred, new CanvasHostDisconnectedError({ threadId, requestId })),
      { discard: true },
    );

  /**
   * `end` completes the host's stream so a host that timed out can connect
   * again; `shutdown` is for a generation that a newer connection replaced.
   */
  const disconnect = (clientId: string, queue: HostQueue, close: "end" | "shutdown") =>
    SynchronizedRef.modifyEffect(state, (current) => {
      if (current.hosts.get(clientId)?.queue !== queue) {
        return Effect.succeed([undefined, current] as const);
      }
      const removed = removeHost(current, clientId, queue);
      return (close === "end" ? Queue.end(queue) : Queue.shutdown(queue)).pipe(
        Effect.andThen(failOrphaned(removed.orphaned)),
        Effect.as([undefined, removed.state] as const),
      );
    });

  const acquire = Effect.fn("CanvasHostBroker.acquire")(function* (host: CanvasHost) {
    const queue = yield* Queue.unbounded<CanvasHostStreamEvent, Cause.Done>();
    const connectionId = yield* crypto.randomUUIDv4.pipe(Effect.orDie);
    yield* Queue.offer(queue, { type: "connected", connectionId });
    const replaced = yield* SynchronizedRef.modify(state, (current) => {
      const previous = current.hosts.get(host.clientId);
      const removed = previous
        ? removeHost(current, host.clientId, previous.queue)
        : { state: current, orphaned: [] };
      const connection: HostConnection = {
        clientId: host.clientId,
        connectionId,
        environmentId: host.environmentId,
        order: removed.state.sequence,
        queue,
      };
      const hosts = new Map(removed.state.hosts);
      hosts.set(host.clientId, connection);
      return [
        { previous, orphaned: removed.orphaned, connection },
        { ...removed.state, hosts, sequence: removed.state.sequence + 1 },
      ] as const;
    });
    if (replaced.previous) {
      yield* Queue.shutdown(replaced.previous.queue);
      yield* failOrphaned(replaced.orphaned);
    }
    return replaced.connection;
  });

  const connect: CanvasHostBroker["Service"]["connect"] = (host) =>
    Effect.succeed(
      Stream.unwrap(
        Effect.acquireRelease(acquire(host), (connection) =>
          disconnect(connection.clientId, connection.queue, "shutdown"),
        ).pipe(Effect.map((connection) => Stream.fromQueue(connection.queue))),
      ),
    );

  const respond: CanvasHostBroker["Service"]["respond"] = Effect.fn("CanvasHostBroker.respond")(
    function* (response) {
      const entry = yield* SynchronizedRef.modify(state, (current) => {
        const pending = current.pending.get(response.requestId);
        // A host may answer only the requests it was sent.
        if (
          !pending ||
          pending.clientId !== response.clientId ||
          pending.connectionId !== response.connectionId
        ) {
          return [undefined, current] as const;
        }
        const next = new Map(current.pending);
        next.delete(response.requestId);
        return [pending, { ...current, pending: next }] as const;
      });
      if (!entry) return;
      yield* response.ok
        ? Deferred.succeed(entry.deferred, response.result)
        : Deferred.fail(
            entry.deferred,
            new CanvasHostRejectedError({
              threadId: entry.threadId,
              requestId: response.requestId,
              reason: response.error?.message ?? "no reason given.",
            }),
          );
    },
  );

  const invoke: CanvasHostBroker["Service"]["invoke"] = Effect.fn("CanvasHostBroker.invoke")(
    function* ({ scope, command, timeoutMs = DEFAULT_TIMEOUT_MS }) {
      const deferred = yield* Deferred.make<unknown, CanvasHostError>();
      const route = yield* SynchronizedRef.modifyEffect(state, (current) => {
        const host = Array.from(current.hosts.values())
          .filter((candidate) => candidate.environmentId === scope.environmentId)
          .sort((left, right) => right.order - left.order)[0];
        if (!host) return Effect.succeed([undefined, current] as const);
        const requestId = `canvas-${current.sequence}`;
        const pending = new Map(current.pending);
        pending.set(requestId, {
          queue: host.queue,
          clientId: host.clientId,
          connectionId: host.connectionId,
          threadId: scope.threadId,
          deferred,
        });
        // Offer inside the update so a concurrent disconnect cannot strand the request.
        return Queue.offer(host.queue, {
          type: "request",
          connectionId: host.connectionId,
          request: { requestId, threadId: scope.threadId, command, timeoutMs },
        }).pipe(
          Effect.as([
            { host, requestId },
            { ...current, pending, sequence: current.sequence + 1 },
          ] as const),
        );
      });
      if (!route) {
        return yield* new CanvasHostUnavailableError({
          threadId: scope.threadId,
          environmentId: scope.environmentId,
        });
      }
      const answer = yield* Deferred.await(deferred).pipe(
        Effect.timeoutOption(timeoutMs),
        Effect.ensuring(
          SynchronizedRef.update(state, (current) => {
            if (!current.pending.has(route.requestId)) return current;
            const pending = new Map(current.pending);
            pending.delete(route.requestId);
            return { ...current, pending };
          }),
        ),
      );
      if (Option.isSome(answer)) return answer.value;
      // A host that does not answer is dropped; the request is not replayed.
      yield* disconnect(route.host.clientId, route.host.queue, "end");
      return yield* new CanvasHostTimeoutError({
        threadId: scope.threadId,
        requestId: route.requestId,
        timeoutMs,
      });
    },
  );

  return CanvasHostBroker.of({ connect, respond, invoke });
}).pipe(Effect.withSpan("CanvasHostBroker.make"));

export const layer = Layer.effect(CanvasHostBroker, make);
