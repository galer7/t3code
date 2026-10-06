import {
  CanvasEditResult,
  CanvasMarkResult,
  CanvasShowCodeResult,
  CanvasStartTraceResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as CanvasStore from "../../../canvas/CanvasStore.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import {
  CanvasRangeInvalidError,
  CanvasThreadLookupError,
  CanvasThreadNotFoundError,
  CanvasToolkit,
} from "./tools.ts";

const isShowCodeResult = Schema.is(CanvasShowCodeResult);
const isStartTraceResult = Schema.is(CanvasStartTraceResult);
const isMarkResult = Schema.is(CanvasMarkResult);
const isEditResult = Schema.is(CanvasEditResult);

const make = Effect.gen(function* () {
  const store = yield* CanvasStore.CanvasStore;
  const snapshots = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const paths = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;

  /** The nearest folder above `path` with a `.git`, so a card knows its repo. */
  const repoOf = (path: string) =>
    Effect.gen(function* () {
      let folder = paths.dirname(path);
      for (;;) {
        if (yield* fs.exists(paths.join(folder, ".git")).pipe(Effect.orElseSucceed(() => false))) {
          return folder;
        }
        const parent = paths.dirname(folder);
        if (parent === folder) return undefined;
        folder = parent;
      }
    });

  /** The thread's worktree, or its project's root, which is where the agent runs. */
  const workspaceOf = Effect.fn("CanvasToolkit.workspaceOf")(function* (
    scope: McpInvocationContext.McpInvocationScope,
  ) {
    const thread = yield* snapshots.getThreadShellById(scope.threadId);
    if (Option.isNone(thread)) {
      return yield* new CanvasThreadNotFoundError({ threadId: scope.threadId });
    }
    if (thread.value.worktreePath !== null) return thread.value.worktreePath;
    const project = yield* snapshots.getProjectShellById(thread.value.projectId);
    if (Option.isNone(project)) {
      return yield* new CanvasThreadNotFoundError({ threadId: scope.threadId });
    }
    return project.value.workspaceRoot;
  });

  /** An absolute path: relative paths are in the thread's workspace. */
  const resolvePath = (scope: McpInvocationContext.McpInvocationScope, path: string) =>
    paths.isAbsolute(path)
      ? Effect.succeed(paths.normalize(path))
      : workspaceOf(scope).pipe(
          Effect.catchTags({
            PersistenceSqlError: (cause) => Effect.fail(new CanvasThreadLookupError({ cause })),
            PersistenceDecodeError: (cause) => Effect.fail(new CanvasThreadLookupError({ cause })),
          }),
          Effect.map((root) => paths.join(root, path)),
        );

  const runEdit = (
    scope: McpInvocationContext.McpInvocationScope,
    command: Parameters<typeof store.apply>[1],
  ) =>
    store
      .apply(scope.threadId, command)
      .pipe(
        Effect.flatMap((result) =>
          isEditResult(result)
            ? Effect.succeed({ done: result.done })
            : Effect.die("no edit result"),
        ),
      );

  return CanvasToolkit.of({
    trace_show_code: ({ path, startLine, endLine, lane, title, caption, trace, before }) =>
      Effect.gen(function* () {
        const scope = yield* McpInvocationContext.requireMcpCapability("canvas");
        if (endLine < startLine) {
          return yield* new CanvasRangeInvalidError({ startLine, endLine });
        }
        const absolutePath = yield* resolvePath(scope, path);
        const repo = yield* repoOf(absolutePath);
        const result = yield* store.apply(scope.threadId, {
          type: "showCode",
          path: absolutePath,
          ...(repo === undefined ? {} : { repo }),
          startLine,
          endLine,
          ...(lane === undefined ? {} : { lane }),
          ...(title === undefined ? {} : { title }),
          ...(caption === undefined ? {} : { caption }),
          ...(trace === undefined ? {} : { trace }),
          ...(before === undefined ? {} : { before }),
        });
        if (!isShowCodeResult(result)) return yield* Effect.die("trace_show_code: no card id");
        return { cardId: result.cardId, traceId: result.traceId };
      }),
    trace_start: ({ title }) =>
      Effect.gen(function* () {
        const scope = yield* McpInvocationContext.requireMcpCapability("canvas");
        const result = yield* store.apply(scope.threadId, { type: "startTrace", title });
        if (!isStartTraceResult(result)) return yield* Effect.die("trace_start: no trace id");
        return { traceId: result.traceId };
      }),
    trace_mark: ({ cardId, startLine, endLine, text, tone }) =>
      Effect.gen(function* () {
        const scope = yield* McpInvocationContext.requireMcpCapability("canvas");
        const result = yield* store.apply(scope.threadId, {
          type: "mark",
          cardId,
          startLine,
          text,
          ...(endLine === undefined ? {} : { endLine }),
          ...(tone === undefined ? {} : { tone }),
        });
        if (!isMarkResult(result)) return yield* Effect.die("trace_mark: no mark id");
        return { markId: result.markId };
      }),
    trace_edit_card: ({
      cardId,
      path,
      startLine,
      endLine,
      lane,
      title,
      caption,
      moveBefore,
      remove,
    }) =>
      Effect.gen(function* () {
        const scope = yield* McpInvocationContext.requireMcpCapability("canvas");
        const absolutePath = path === undefined ? undefined : yield* resolvePath(scope, path);
        const repo = absolutePath === undefined ? undefined : yield* repoOf(absolutePath);
        return yield* runEdit(scope, {
          type: "editCard",
          cardId,
          ...(absolutePath === undefined ? {} : { path: absolutePath }),
          ...(repo === undefined ? {} : { repo }),
          ...(startLine === undefined ? {} : { startLine }),
          ...(endLine === undefined ? {} : { endLine }),
          ...(lane === undefined ? {} : { lane }),
          ...(title === undefined ? {} : { title }),
          ...(caption === undefined ? {} : { caption }),
          ...(moveBefore === undefined ? {} : { moveBefore }),
          ...(remove === undefined ? {} : { remove }),
        });
      }),
    trace_rename: ({ trace, title }) =>
      Effect.gen(function* () {
        const scope = yield* McpInvocationContext.requireMcpCapability("canvas");
        return yield* runEdit(scope, {
          type: "renameTrace",
          title,
          ...(trace === undefined ? {} : { trace }),
        });
      }),
    trace_edit_mark: ({ markId, startLine, endLine, text, tone, remove }) =>
      Effect.gen(function* () {
        const scope = yield* McpInvocationContext.requireMcpCapability("canvas");
        return yield* runEdit(scope, {
          type: "editMark",
          markId,
          ...(startLine === undefined ? {} : { startLine }),
          ...(endLine === undefined ? {} : { endLine }),
          ...(text === undefined ? {} : { text }),
          ...(tone === undefined ? {} : { tone }),
          ...(remove === undefined ? {} : { remove }),
        });
      }),
  });
});

export const CanvasToolkitHandlersLive = CanvasToolkit.toLayer(make);
