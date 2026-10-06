/**
 * Draw-out canvas prototype: pipes LSP messages between a browser editor and a
 * language server on this machine. Each `connect` stream starts one language
 * server at the file's project root and stops it when the stream ends.
 */
// Raw stdio framing over a long-lived child process: plain Node streams fit it.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFs from "node:fs";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";

import type { LspConnectInput, LspStreamEvent } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

interface LanguageServerSpec {
  readonly command: readonly string[];
  /** The project root is the nearest folder with one of these files. */
  readonly rootMarkers: readonly string[];
}

/** Prototype: built in. Later a repo declares its language servers. */
const LANGUAGE_SERVERS: Readonly<Record<string, LanguageServerSpec>> = {
  ruby: { command: ["ruby-lsp"], rootMarkers: ["Gemfile"] },
  typescript: {
    command: ["typescript-language-server", "--stdio"],
    rootMarkers: ["tsconfig.json", "package.json"],
  },
  javascript: {
    command: ["typescript-language-server", "--stdio"],
    rootMarkers: ["jsconfig.json", "tsconfig.json", "package.json"],
  },
};

export class LspBridge extends Context.Service<
  LspBridge,
  {
    readonly connect: (input: LspConnectInput) => Stream.Stream<LspStreamEvent>;
    readonly send: (sessionId: string, message: unknown) => Effect.Effect<void>;
  }
>()("t3/lsp/LspBridge") {}

function findRoot(filePath: string, markers: readonly string[]): string | null {
  let directory = NodePath.dirname(filePath);
  for (;;) {
    if (markers.some((marker) => NodeFs.existsSync(NodePath.join(directory, marker)))) {
      return directory;
    }
    const parent = NodePath.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

/** A systemd unit's PATH lacks the user's tool shims, where language servers live. */
function languageServerEnv(): NodeJS.ProcessEnv {
  const home = NodeOs.homedir();
  const extra = [NodePath.join(home, ".local/share/mise/shims"), NodePath.join(home, ".local/bin")];
  return { ...process.env, PATH: [...extra, process.env.PATH ?? ""].join(":") };
}

const encode = (message: unknown) => {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
};

export const make = Effect.sync(() => {
  const sessions = new Map<string, NodeChildProcess.ChildProcess>();
  let sequence = 0;

  const connect = (input: LspConnectInput): Stream.Stream<LspStreamEvent> =>
    Stream.callback<LspStreamEvent>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const spec = LANGUAGE_SERVERS[input.languageId];
          if (!spec) {
            Queue.offerUnsafe(queue, {
              type: "unavailable",
              reason: `No language server is set up for ${input.languageId}.`,
            });
            Queue.endUnsafe(queue);
            return null;
          }
          const root = findRoot(input.path, spec.rootMarkers);
          if (!root) {
            Queue.offerUnsafe(queue, {
              type: "unavailable",
              reason: `No ${spec.rootMarkers.join(" or ")} above ${input.path}.`,
            });
            Queue.endUnsafe(queue);
            return null;
          }
          const [command, ...args] = spec.command;
          const child = NodeChildProcess.spawn(command!, args, {
            cwd: root,
            env: languageServerEnv(),
            stdio: ["pipe", "pipe", "pipe"],
          });
          sequence += 1;
          const sessionId = `lsp-${process.pid}-${sequence}`;
          sessions.set(sessionId, child);
          let buffer = Buffer.alloc(0);
          child.stdout.on("data", (chunk: Buffer) => {
            buffer = Buffer.concat([buffer, chunk]);
            for (;;) {
              const headerEnd = buffer.indexOf("\r\n\r\n");
              if (headerEnd < 0) return;
              const header = buffer.subarray(0, headerEnd).toString();
              const length = Number(/Content-Length: (\d+)/i.exec(header)?.[1] ?? Number.NaN);
              if (!Number.isFinite(length)) {
                buffer = buffer.subarray(headerEnd + 4);
                continue;
              }
              if (buffer.length < headerEnd + 4 + length) return;
              const body = buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString();
              buffer = buffer.subarray(headerEnd + 4 + length);
              try {
                Queue.offerUnsafe(queue, { type: "message", message: JSON.parse(body) });
              } catch {
                // A message that is not JSON is dropped.
              }
            }
          });
          child.stderr.on("data", () => {});
          child.on("error", (error) => {
            Queue.offerUnsafe(queue, { type: "unavailable", reason: error.message });
            Queue.endUnsafe(queue);
          });
          child.on("exit", (code) => {
            sessions.delete(sessionId);
            Queue.offerUnsafe(queue, { type: "exited", code });
            Queue.endUnsafe(queue);
          });
          Queue.offerUnsafe(queue, {
            type: "ready",
            sessionId,
            rootPath: root,
            server: spec.command.join(" "),
          });
          return { sessionId, child };
        }),
        (session) =>
          Effect.sync(() => {
            if (!session) return;
            sessions.delete(session.sessionId);
            session.child.kill();
          }),
      ),
    );

  const send = (sessionId: string, message: unknown) =>
    Effect.sync(() => {
      sessions.get(sessionId)?.stdin?.write(encode(message));
    });

  return LspBridge.of({ connect, send });
});

export const layer = Layer.effect(LspBridge, make);
