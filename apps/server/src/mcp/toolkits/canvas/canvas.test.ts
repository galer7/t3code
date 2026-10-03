/**
 * Draw-out: the canvas protocol at its boundary. A test calls `canvas_show_code`
 * over HTTP with a thread's MCP token, as the agent does. A fake Draw-out
 * client, connected as a canvas host over the canvas-host RPCs, applies each
 * request to its canvas model and answers. The test checks that model.
 */
import { NodeHttpServer } from "@effect/platform-node";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  type CanvasHostRequest,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  WS_METHODS,
  WsRpcGroup,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpBody, HttpClient, HttpRouter } from "effect/unstable/http";
import { RpcGroup, RpcTest } from "effect/unstable/rpc";

import * as ServerEnvironment from "../../../environment/ServerEnvironment.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as CanvasHostBroker from "../../CanvasHostBroker.ts";
import * as McpHttpServer from "../../McpHttpServer.ts";
import * as McpSessionRegistry from "../../McpSessionRegistry.ts";

const environmentId = EnvironmentId.make("environment-canvas-test");
const threadA = ThreadId.make("thread-canvas-a");
const threadB = ThreadId.make("thread-canvas-b");
const projectId = ProjectId.make("project-canvas");
const workspaceRoot = "/repo/canvas";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

const fakeEnvironment = ServerEnvironment.ServerEnvironment.of({
  getEnvironmentId: Effect.succeed(environmentId),
  getDescriptor: Effect.die("unused"),
});

const TestLayer = Layer.mergeAll(
  CanvasHostBroker.layer,
  Layer.effect(McpSessionRegistry.McpSessionRegistry, McpSessionRegistry.__testing.make()).pipe(
    Layer.provide(Layer.succeed(ServerEnvironment.ServerEnvironment, fakeEnvironment)),
  ),
  Layer.mock(ProjectionSnapshotQuery)({
    getThreadShellById: (threadId) =>
      Effect.succeedSome({ id: threadId, projectId, worktreePath: null } as never),
    getProjectShellById: () => Effect.succeedSome({ id: projectId, workspaceRoot } as never),
  }),
).pipe(Layer.provideMerge(NodeHttpServer.layerTest), Layer.provideMerge(NodeServices.layer));

/** Serves `/mcp` with the real bearer auth and the canvas toolkit. */
const serveMcp = HttpRouter.serve(
  McpHttpServer.CanvasToolkitRegistrationLive.pipe(
    Layer.provideMerge(McpHttpServer.McpTransportLive),
  ),
  { disableListenLog: true, disableLogger: true },
).pipe(Layer.build);

const issueToken = (threadId: ThreadId) =>
  Effect.gen(function* () {
    const registry = yield* McpSessionRegistry.McpSessionRegistry;
    const issued = yield* registry.issue({
      threadId,
      providerInstanceId: ProviderInstanceId.make("claudeAgent"),
      capabilities: new Set(["canvas"]),
    });
    return issued.config.authorizationHeader;
  });

interface ToolResult {
  readonly isError?: boolean;
  readonly structuredContent?: unknown;
  readonly content: ReadonlyArray<{ readonly type: string; readonly text?: string }>;
}

/** One JSON-RPC message from a plain JSON or a server-sent-events body. */
const readJsonRpc = (body: string): { readonly result: ToolResult } => {
  const data = body
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .join("");
  return decodeJson(data.length > 0 ? data : body) as { readonly result: ToolResult };
};

/** Calls an MCP tool over HTTP as the agent does: initialize, then tools/call. */
const callTool = (authorization: string, name: string, args: Record<string, unknown>) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const headers = { accept: "application/json, text/event-stream", authorization };
    const initialized = yield* http.post("/mcp", {
      headers,
      body: HttpBody.text(
        encodeJson({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "canvas-test", version: "1.0.0" },
          },
        }),
        "application/json",
      ),
    });
    expect(initialized.status).toBe(200);
    const sessionId = initialized.headers["mcp-session-id"]!;
    const response = yield* http.post("/mcp", {
      headers: { ...headers, "mcp-session-id": sessionId, "mcp-protocol-version": "2025-06-18" },
      body: HttpBody.text(
        encodeJson({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name, arguments: args },
        }),
        "application/json",
      ),
    });
    return readJsonRpc(yield* response.text).result;
  });

interface Card {
  readonly cardId: string;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
}

/**
 * A fake Draw-out client: connects as a canvas host over the canvas-host RPCs
 * and applies each request to the canvas of the request's thread.
 */
const connectFakeCanvasHost = (hostEnvironmentId: EnvironmentId) =>
  Effect.gen(function* () {
    const broker = yield* CanvasHostBroker.CanvasHostBroker;
    const group = RpcGroup.make(
      ...Array.from(WsRpcGroup.requests.values()).filter(
        (rpc) =>
          rpc._tag === WS_METHODS.canvasHostConnect || rpc._tag === WS_METHODS.canvasHostRespond,
      ),
    );
    const client = yield* RpcTest.makeClient(group).pipe(
      Effect.provide(
        group.toLayer({
          [WS_METHODS.canvasHostConnect]: (host) => Stream.unwrap(broker.connect(host)),
          [WS_METHODS.canvasHostRespond]: (response) => broker.respond(response),
        }),
      ),
    );
    const clientId = "fake-draw-out";
    const requests: Array<CanvasHostRequest> = [];
    const canvases = new Map<ThreadId, Array<Card>>();
    const connected = yield* Deferred.make<void>();
    yield* Stream.runForEach(
      client[WS_METHODS.canvasHostConnect]({ clientId, environmentId: hostEnvironmentId }),
      (event) => {
        if (event.type === "connected") return Deferred.succeed(connected, undefined);
        const { request } = event;
        requests.push(request);
        const cards = canvases.get(request.threadId) ?? [];
        const card = {
          cardId: `card-${cards.length + 1}`,
          path: request.command.path,
          startLine: request.command.startLine,
          endLine: request.command.endLine,
        };
        canvases.set(request.threadId, [...cards, card]);
        return client[WS_METHODS.canvasHostRespond]({
          clientId,
          connectionId: event.connectionId,
          requestId: request.requestId,
          ok: true,
          result: { cardId: card.cardId },
        });
      },
    ).pipe(Effect.forkScoped);
    yield* Deferred.await(connected);
    return { requests, canvases };
  });

it.effect("shows code as one card on the calling thread's canvas and returns its id", () =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* serveMcp;
      const host = yield* connectFakeCanvasHost(environmentId);
      const tokenA = yield* issueToken(threadA);
      yield* issueToken(threadB);

      const result = yield* callTool(tokenA, "canvas_show_code", {
        path: "src/orders/cancel.ts",
        startLine: 12,
        endLine: 40,
      });

      expect(result.isError).toBeFalsy();
      expect(host.requests).toHaveLength(1);
      expect(host.requests[0]?.threadId).toBe(threadA);
      expect(host.canvases.get(threadA)).toEqual([
        {
          cardId: "card-1",
          path: `${workspaceRoot}/src/orders/cancel.ts`,
          startLine: 12,
          endLine: 40,
        },
      ]);
      expect(host.canvases.get(threadB)).toBeUndefined();
      expect(result.structuredContent).toEqual({ cardId: "card-1" });
    }),
  ).pipe(Effect.provide(TestLayer)),
);

it.effect("keeps an absolute path as it is", () =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* serveMcp;
      const host = yield* connectFakeCanvasHost(environmentId);
      const token = yield* issueToken(threadA);

      yield* callTool(token, "canvas_show_code", {
        path: "/elsewhere/lib/zoom.ts",
        startLine: 1,
        endLine: 1,
      });

      expect(host.canvases.get(threadA)?.map((card) => card.path)).toEqual([
        "/elsewhere/lib/zoom.ts",
      ]);
    }),
  ).pipe(Effect.provide(TestLayer)),
);

it.effect("tells the agent clearly when no Draw-out window is connected", () =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* serveMcp;
      const token = yield* issueToken(threadA);

      const result = yield* callTool(token, "canvas_show_code", {
        path: "src/orders/cancel.ts",
        startLine: 1,
        endLine: 5,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("No Draw-out window is connected");
    }),
  ).pipe(Effect.provide(TestLayer)),
);

it.effect("sends a request only to a canvas host of the thread's environment", () =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* serveMcp;
      const otherHost = yield* connectFakeCanvasHost(EnvironmentId.make("environment-other"));
      const token = yield* issueToken(threadA);

      const result = yield* callTool(token, "canvas_show_code", {
        path: "src/orders/cancel.ts",
        startLine: 1,
        endLine: 5,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("No Draw-out window is connected");
      expect(otherHost.requests).toHaveLength(0);
    }),
  ).pipe(Effect.provide(TestLayer)),
);

it.effect("rejects a range that ends before it starts", () =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* serveMcp;
      const host = yield* connectFakeCanvasHost(environmentId);
      const token = yield* issueToken(threadA);

      const result = yield* callTool(token, "canvas_show_code", {
        path: "src/orders/cancel.ts",
        startLine: 9,
        endLine: 3,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("endLine");
      expect(host.requests).toHaveLength(0);
    }),
  ).pipe(Effect.provide(TestLayer)),
);
