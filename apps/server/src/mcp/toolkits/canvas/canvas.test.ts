/**
 * Draw-out: the canvas tools at their boundary. A test calls a `trace_*` tool
 * over HTTP with a thread's MCP token, as the agent does, and reads the
 * thread's canvas from the server's canvas store, as a window does.
 */
import { NodeHttpServer } from "@effect/platform-node";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  WS_METHODS,
  WsRpcGroup,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { HttpBody, HttpClient, HttpRouter } from "effect/unstable/http";
import { RpcGroup, RpcTest } from "effect/unstable/rpc";

import * as ServerEnvironment from "../../../environment/ServerEnvironment.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as CanvasStore from "../../../canvas/CanvasStore.ts";
import * as ServerConfig from "../../../config.ts";
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
  CanvasStore.layer.pipe(
    Layer.provide(ServerConfig.layerTest(workspaceRoot, { prefix: "draw-out-canvas-test-" })),
  ),
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

const canvasOf = (threadId: ThreadId) =>
  Effect.gen(function* () {
    const store = yield* CanvasStore.CanvasStore;
    return yield* store.get(threadId);
  });

it.effect("shows code as one card on the calling thread's canvas and returns its id", () =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* serveMcp;
      const token = yield* issueToken(threadA);

      const result = yield* callTool(token, "trace_show_code", {
        path: "app/controllers/uploads_controller.rb",
        startLine: 4,
        endLine: 18,
        title: "UploadsController#create",
        caption: "Attaches the file to the record.",
      });

      expect({
        result: result.structuredContent,
        cards: (yield* canvasOf(threadA)).cards,
        otherThread: (yield* canvasOf(threadB)).cards,
      }).toEqual({
        result: { cardId: "c1", traceId: "t1" },
        cards: [
          {
            id: "c1",
            path: `${workspaceRoot}/app/controllers/uploads_controller.rb`,
            startLine: 4,
            endLine: 18,
            lane: "backend",
            title: "UploadsController#create",
            caption: "Attaches the file to the record.",
            after: null,
            trace: "t1",
          },
        ],
        otherThread: [],
      });
    }),
  ).pipe(Effect.provide(TestLayer)),
);

it.effect("keeps the lane the agent gives, and refuses a lane that does not exist", () =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* serveMcp;
      const token = yield* issueToken(threadA);

      yield* callTool(token, "trace_show_code", {
        path: "zoom.ts",
        startLine: 1,
        endLine: 9,
        lane: "external",
      });
      const unknown = yield* callTool(token, "trace_show_code", {
        path: "cancel.ts",
        startLine: 1,
        endLine: 9,
        lane: "database",
      });

      expect({
        lanes: (yield* canvasOf(threadA)).cards.map((card) => card.lane),
        // The input schema refuses it: a JSON-RPC error, so there is no tool result.
        unknownRefused: unknown === undefined || unknown.isError === true,
      }).toEqual({ lanes: ["external"], unknownRefused: true });
    }),
  ).pipe(Effect.provide(TestLayer)),
);

it.effect("starts traces, adds cards to the current one, and marks lines of a card", () =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* serveMcp;
      const token = yield* issueToken(threadA);

      yield* callTool(token, "trace_show_code", { path: "upload.ts", startLine: 1, endLine: 20 });
      const started = yield* callTool(token, "trace_start", { title: "Zoom cancel webhook" });
      const second = yield* callTool(token, "trace_show_code", {
        path: "zoom.ts",
        startLine: 4,
        endLine: 18,
      });
      const older = yield* callTool(token, "trace_show_code", {
        path: "api.ts",
        startLine: 1,
        endLine: 3,
        trace: "t1",
      });
      const marked = yield* callTool(token, "trace_mark", {
        cardId: "c2",
        startLine: 7,
        text: "One webhook per attendee.",
        tone: "finding",
      });
      const missing = yield* callTool(token, "trace_mark", {
        cardId: "c9",
        startLine: 1,
        text: "x",
      });
      const unknownTrace = yield* callTool(token, "trace_show_code", {
        path: "b.ts",
        startLine: 1,
        endLine: 2,
        trace: "t7",
      });

      const canvas = yield* canvasOf(threadA);
      expect({
        started: started.structuredContent,
        second: second.structuredContent,
        older: older.structuredContent,
        marked: marked.structuredContent,
        traces: canvas.traces,
        current: canvas.currentTrace,
        cards: canvas.cards.map((card) => [card.id, card.trace]),
        marks: canvas.marks,
        missing: missing.content[0]?.text,
        unknownTrace: unknownTrace.content[0]?.text,
      }).toEqual({
        started: { traceId: "t2" },
        second: { cardId: "c2", traceId: "t2" },
        older: { cardId: "c3", traceId: "t1" },
        marked: { markId: "m1" },
        traces: [
          { id: "t1", title: "Trace 1" },
          { id: "t2", title: "Zoom cancel webhook" },
        ],
        current: "t1",
        cards: [
          ["c1", "t1"],
          ["c2", "t2"],
          ["c3", "t1"],
        ],
        marks: [
          {
            id: "m1",
            cardId: "c2",
            startLine: 7,
            endLine: 7,
            text: "One webhook per attendee.",
            tone: "finding",
          },
        ],
        missing: "No card c9 on this canvas. Card ids: c1, c2, c3.",
        unknownTrace: "No trace t7 in this thread. Trace ids: t1, t2.",
      });
    }),
  ).pipe(Effect.provide(TestLayer)),
);

it.effect("shows a range once: showing it again returns the same card", () =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* serveMcp;
      const token = yield* issueToken(threadA);

      yield* callTool(token, "trace_show_code", { path: "a.rb", startLine: 1, endLine: 5 });
      const again = yield* callTool(token, "trace_show_code", {
        path: "a.rb",
        startLine: 1,
        endLine: 5,
        title: "A",
      });

      const canvas = yield* canvasOf(threadA);
      expect({
        again: again.structuredContent,
        titles: canvas.cards.map((card) => card.title),
      }).toEqual({
        again: { cardId: "c1", traceId: "t1" },
        titles: ["A"],
      });
    }),
  ).pipe(Effect.provide(TestLayer)),
);

it.effect(
  "lets the user delete a trace with its cards and marks; the agent has no tool for it",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* serveMcp;
        const token = yield* issueToken(threadA);
        const store = yield* CanvasStore.CanvasStore;

        yield* callTool(token, "trace_show_code", { path: "a.rb", startLine: 1, endLine: 2 });
        yield* callTool(token, "trace_start", { title: "Second" });
        yield* callTool(token, "trace_show_code", { path: "b.rb", startLine: 1, endLine: 2 });
        yield* callTool(token, "trace_mark", { cardId: "c2", startLine: 1, text: "x" });
        const clear = yield* callTool(token, "trace_clear", {});
        yield* store.edit(threadA, { type: "removeTrace", traceId: "t2" });

        const canvas = yield* canvasOf(threadA);
        expect({
          clearRefused: clear === undefined || clear.isError === true,
          traces: canvas.traces,
          current: canvas.currentTrace,
          cards: canvas.cards.map((card) => card.id),
          marks: canvas.marks,
        }).toEqual({
          clearRefused: true,
          traces: [{ id: "t1", title: "Trace 1" }],
          current: "t1",
          cards: ["c1"],
          marks: [],
        });
      }),
    ).pipe(Effect.provide(TestLayer)),
);

it.effect("keeps an absolute path as it is", () =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* serveMcp;
      const token = yield* issueToken(threadA);

      yield* callTool(token, "trace_show_code", {
        path: "/srv/other/lib/x.ts",
        startLine: 3,
        endLine: 4,
      });

      expect((yield* canvasOf(threadA)).cards[0]?.path).toBe("/srv/other/lib/x.ts");
    }),
  ).pipe(Effect.provide(TestLayer)),
);

it.effect("rejects a range that ends before it starts", () =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* serveMcp;
      const token = yield* issueToken(threadA);

      const result = yield* callTool(token, "trace_show_code", {
        path: "a.rb",
        startLine: 9,
        endLine: 2,
      });

      expect({ text: result.content[0]?.text, cards: (yield* canvasOf(threadA)).cards }).toEqual({
        text: "endLine 2 is before startLine 9. Pass a range whose endLine is at or after its startLine.",
        cards: [],
      });
    }),
  ).pipe(Effect.provide(TestLayer)),
);

it.effect("pins, removes and keeps the user's edits on the canvas", () =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* serveMcp;
      const token = yield* issueToken(threadA);
      const store = yield* CanvasStore.CanvasStore;

      yield* callTool(token, "trace_show_code", { path: "a.rb", startLine: 1, endLine: 2 });
      yield* callTool(token, "trace_show_code", { path: "b.rb", startLine: 1, endLine: 2 });
      yield* store.edit(threadA, { type: "pin", cardId: "c2", x: 40, y: 900 });
      yield* store.edit(threadA, { type: "remove", cardId: "c1" });

      const canvas = yield* canvasOf(threadA);
      expect({
        cards: canvas.cards.map((card) => card.id),
        pinned: canvas.pinned,
      }).toEqual({ cards: ["c2"], pinned: { c2: { x: 40, y: 900 } } });
    }),
  ).pipe(Effect.provide(TestLayer)),
);

it.effect(
  "edits a card's lines and words, moves it, renames a trace, and edits and removes marks",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* serveMcp;
        const token = yield* issueToken(threadA);

        yield* callTool(token, "trace_show_code", { path: "a.rb", startLine: 1, endLine: 2 });
        yield* callTool(token, "trace_show_code", { path: "b.rb", startLine: 1, endLine: 2 });
        yield* callTool(token, "trace_show_code", { path: "c.rb", startLine: 1, endLine: 2 });
        yield* callTool(token, "trace_mark", { cardId: "c1", startLine: 1, text: "old" });
        yield* callTool(token, "trace_mark", { cardId: "c3", startLine: 1, text: "gone" });

        const edited = yield* callTool(token, "trace_edit_card", {
          cardId: "c2",
          startLine: 4,
          endLine: 9,
          caption: "Now the right lines.",
          moveBefore: "c1",
        });
        const badRange = yield* callTool(token, "trace_edit_card", { cardId: "c2", endLine: 1 });
        yield* callTool(token, "trace_edit_card", { cardId: "c3", remove: true });
        yield* callTool(token, "trace_rename", { title: "Uploads" });
        yield* callTool(token, "trace_edit_mark", { markId: "m1", text: "new", tone: "finding" });
        const missingMark = yield* callTool(token, "trace_edit_mark", {
          markId: "m2",
          remove: true,
        });

        const canvas = yield* canvasOf(threadA);
        expect({
          edited: edited.structuredContent,
          badRange: badRange.content[0]?.text,
          cards: canvas.cards.map((card) => [card.id, card.startLine, card.endLine, card.caption]),
          traces: canvas.traces,
          marks: canvas.marks?.map((mark) => [mark.id, mark.text, mark.tone]),
          missingMark: missingMark.content[0]?.text,
        }).toEqual({
          edited: { done: "changed card c2" },
          badRange: "The edit leaves endLine 1 before startLine 4. Pass both lines.",
          cards: [
            ["c2", 4, 9, "Now the right lines."],
            ["c1", 1, 2, null],
          ],
          traces: [{ id: "t1", title: "Uploads" }],
          marks: [["m1", "new", "finding"]],
          missingMark: "No mark m2 in this thread. Mark ids: m1.",
        });
      }),
    ).pipe(Effect.provide(TestLayer)),
);

it.effect("records the git repo of each card, so one trace can show two repos", () =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* serveMcp;
      const token = yield* issueToken(threadA);
      const fs = yield* FileSystem.FileSystem;
      const site = yield* fs.makeTempDirectoryScoped({ prefix: "draw-out-site-" });
      yield* fs.makeDirectory(`${site}/.git`);
      yield* fs.makeDirectory(`${site}/src/pages`, { recursive: true });

      yield* callTool(token, "trace_show_code", {
        path: `${site}/src/pages/landing.tsx`,
        startLine: 1,
        endLine: 4,
      });
      yield* callTool(token, "trace_show_code", {
        path: "/srv/no-repo/x.ts",
        startLine: 1,
        endLine: 2,
      });

      expect((yield* canvasOf(threadA)).cards.map((card) => card.repo)).toEqual([site, undefined]);
    }),
  ).pipe(Effect.provide(TestLayer)),
);
