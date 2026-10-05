import { CanvasShowCodeResult } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as CanvasHostBroker from "../../CanvasHostBroker.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import {
  CanvasRangeInvalidError,
  CanvasThreadLookupError,
  CanvasThreadNotFoundError,
  CanvasToolkit,
} from "./tools.ts";

const isShowCodeResult = Schema.is(CanvasShowCodeResult);

const make = Effect.gen(function* () {
  const broker = yield* CanvasHostBroker.CanvasHostBroker;
  const snapshots = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const paths = yield* Path.Path;

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

  return CanvasToolkit.of({
    canvas_show_code: ({ path, startLine, endLine, lane }) =>
      Effect.gen(function* () {
        const scope = yield* McpInvocationContext.requireMcpCapability("canvas");
        if (endLine < startLine) {
          return yield* new CanvasRangeInvalidError({ startLine, endLine });
        }
        const absolutePath = paths.isAbsolute(path)
          ? paths.normalize(path)
          : paths.join(
              yield* workspaceOf(scope).pipe(
                Effect.catchTags({
                  PersistenceSqlError: (cause) =>
                    Effect.fail(new CanvasThreadLookupError({ cause })),
                  PersistenceDecodeError: (cause) =>
                    Effect.fail(new CanvasThreadLookupError({ cause })),
                }),
              ),
              path,
            );
        const result = yield* broker.invoke({
          scope,
          command: {
            type: "showCode",
            path: absolutePath,
            startLine,
            endLine,
            ...(lane === undefined ? {} : { lane }),
          },
        });
        if (!isShowCodeResult(result)) {
          return yield* new CanvasHostBroker.CanvasHostRejectedError({
            threadId: scope.threadId,
            requestId: "unknown",
            reason: "the Draw-out window answered without a card id.",
          });
        }
        return { cardId: result.cardId };
      }),
  });
});

export const CanvasToolkitHandlersLive = CanvasToolkit.toLayer(make);
