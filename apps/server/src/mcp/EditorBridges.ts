// @effect-diagnostics nodeBuiltinImport:off - sync reads of a tiny directory, no new service requirements for adapters.
/**
 * Editor bridges are MCP servers that an editor extension (Draw-out for VS
 * Code) runs while a window is open. Each one writes a JSON file to
 * `<T3 home>/editor-bridges/` and removes it on exit. At session start an
 * adapter attaches the bridges whose workspace folders match the session's
 * cwd, so the editor tools exist only while the editor is running there.
 * A session in a git worktree also matches the editor window that has the
 * worktree's main checkout open.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export const EDITOR_BRIDGES_DIRECTORY = "editor-bridges";
export const EDITOR_BRIDGE_THREAD_HEADER = "X-T3-Thread-Id";
export const EDITOR_BRIDGE_CWD_HEADER = "X-T3-Thread-Cwd";

/** Names T3 already uses for its own MCP servers. */
const RESERVED_NAMES = new Set(["t3-code"]);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);

const EditorBridgeFile = Schema.Struct({
  version: Schema.Literal(1),
  name: Schema.String,
  url: Schema.String,
  pid: Schema.Int,
  workspaceFolders: Schema.Array(Schema.String),
});
const decodeEditorBridgeFile = Schema.decodeUnknownOption(EditorBridgeFile);

export interface EditorBridgeServer {
  /** MCP server name, already limited to `[A-Za-z0-9_-]`. */
  readonly name: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface EditorBridgeCandidate {
  readonly path: string;
  /** Parsed JSON, or `undefined` when the file could not be read or parsed. */
  readonly content: unknown;
}

export interface EditorBridgeRejection {
  readonly path: string;
  readonly reason: string;
}

function isWithin(child: string, parent: string): boolean {
  if (child === parent) return true;
  const prefix = parent.endsWith(NodePath.sep) ? parent : `${parent}${NodePath.sep}`;
  return child.startsWith(prefix);
}

function readTextFile(path: string): string | undefined {
  try {
    return NodeFS.readFileSync(path, "utf8").trim();
  } catch {
    return undefined;
  }
}

/**
 * Returns the main working tree when `cwd` is inside a linked git worktree,
 * read from the `.git` file and `commondir` without running git. Returns
 * `undefined` for a main checkout, a non-repo folder, or unreadable files.
 */
export function findMainWorktree(cwd: string): string | undefined {
  let directory = NodePath.resolve(cwd);
  while (true) {
    const dotGit = NodePath.join(directory, ".git");
    let stat: NodeFS.Stats | undefined;
    try {
      stat = NodeFS.statSync(dotGit, { throwIfNoEntry: false });
    } catch {
      return undefined;
    }
    if (stat?.isDirectory()) return undefined;
    if (stat?.isFile()) {
      const match = /^gitdir:\s*(.+)$/m.exec(readTextFile(dotGit) ?? "");
      if (!match?.[1]) return undefined;
      const gitDir = NodePath.resolve(directory, match[1].trim());
      const commonDir = readTextFile(NodePath.join(gitDir, "commondir"));
      if (!commonDir) return undefined;
      const resolvedCommonDir = NodePath.resolve(gitDir, commonDir);
      if (NodePath.basename(resolvedCommonDir) !== ".git") return undefined;
      return NodePath.dirname(resolvedCommonDir);
    }
    const parent = NodePath.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

function folderMatchLength(folders: ReadonlyArray<string>, path: string): number {
  let matchLength = -1;
  for (const folder of folders) {
    if (!NodePath.isAbsolute(folder)) continue;
    const resolved = NodePath.resolve(folder);
    if (isWithin(path, resolved) || isWithin(resolved, path)) {
      matchLength = Math.max(matchLength, resolved.length);
    }
  }
  return matchLength;
}

function isLoopbackHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      LOOPBACK_HOSTS.has(parsed.hostname)
    );
  } catch {
    return false;
  }
}

/**
 * Picks the bridges to attach for a session running in `cwd`. A folder
 * matches when it equals `cwd`, contains it, or sits inside it. When `cwd` is
 * in a linked git worktree, the same rules also apply to `mainWorktree`. When
 * several live bridges share a name, a direct match beats a worktree match,
 * then the longest matching folder wins.
 */
export function selectEditorBridges(input: {
  readonly candidates: ReadonlyArray<EditorBridgeCandidate>;
  readonly cwd: string;
  /** Main working tree of the git worktree that holds `cwd`, if any. */
  readonly mainWorktree?: string | undefined;
  readonly threadId: string;
  readonly isPidAlive: (pid: number) => boolean;
}): { servers: ReadonlyArray<EditorBridgeServer>; rejected: ReadonlyArray<EditorBridgeRejection> } {
  const cwd = NodePath.resolve(input.cwd);
  const rejected: Array<EditorBridgeRejection> = [];
  const best = new Map<
    string,
    { path: string; server: EditorBridgeServer; direct: boolean; matchLength: number }
  >();

  for (const candidate of input.candidates) {
    const reject = (reason: string) => rejected.push({ path: candidate.path, reason });
    const decoded = decodeEditorBridgeFile(candidate.content);
    if (Option.isNone(decoded)) {
      reject("invalid bridge file");
      continue;
    }
    const bridge = decoded.value;
    const name = bridge.name.replace(/[^A-Za-z0-9_-]/g, "_");
    if (name.length === 0 || RESERVED_NAMES.has(name)) {
      reject(`unusable name "${bridge.name}"`);
      continue;
    }
    if (!isLoopbackHttpUrl(bridge.url)) {
      reject("url is not http(s) on 127.0.0.1 or localhost");
      continue;
    }
    let matchLength = folderMatchLength(bridge.workspaceFolders, cwd);
    const direct = matchLength >= 0;
    if (!direct && input.mainWorktree !== undefined) {
      matchLength = folderMatchLength(
        bridge.workspaceFolders,
        NodePath.resolve(input.mainWorktree),
      );
    }
    if (matchLength < 0) {
      reject("no workspace folder matches the session cwd");
      continue;
    }
    if (!input.isPidAlive(bridge.pid)) {
      reject(`process ${bridge.pid} is not running`);
      continue;
    }
    const current = best.get(name);
    const currentWins =
      current !== undefined &&
      (current.direct !== direct ? current.direct : current.matchLength >= matchLength);
    if (currentWins) {
      reject(`a bridge named "${name}" with a closer folder match exists`);
      continue;
    }
    if (current) {
      rejected.push({
        path: current.path,
        reason: `a bridge named "${name}" with a closer folder match exists`,
      });
    }
    best.set(name, {
      path: candidate.path,
      direct,
      matchLength,
      server: {
        name,
        url: bridge.url,
        headers: {
          [EDITOR_BRIDGE_THREAD_HEADER]: input.threadId,
          [EDITOR_BRIDGE_CWD_HEADER]: cwd,
        },
      },
    });
  }

  return { servers: [...best.values()].map((entry) => entry.server), rejected };
}

function isPidAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function readCandidates(directory: string): ReadonlyArray<EditorBridgeCandidate> {
  let entries: ReadonlyArray<string>;
  try {
    entries = NodeFS.readdirSync(directory);
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.endsWith(".json"))
    .sort()
    .map((entry) => {
      const path = NodePath.join(directory, entry);
      try {
        return { path, content: JSON.parse(NodeFS.readFileSync(path, "utf8")) as unknown };
      } catch {
        return { path, content: undefined };
      }
    });
}

/**
 * Reads `<baseDir>/editor-bridges/` and returns the bridges to attach for a
 * session. Never fails: a bad file is skipped and logged at debug level.
 */
export const readEditorBridgeServers = Effect.fn("EditorBridges.readEditorBridgeServers")(
  function* (input: {
    readonly baseDir: string;
    readonly cwd: string | null | undefined;
    readonly threadId: string;
  }) {
    if (!input.cwd) return [];
    const directory = NodePath.join(input.baseDir, EDITOR_BRIDGES_DIRECTORY);
    const { servers, rejected } = selectEditorBridges({
      candidates: readCandidates(directory),
      cwd: input.cwd,
      mainWorktree: findMainWorktree(input.cwd),
      threadId: input.threadId,
      isPidAlive,
    });
    if (rejected.length > 0) {
      yield* Effect.logDebug("Skipped editor bridge files.", { rejected });
    }
    if (servers.length > 0) {
      yield* Effect.logDebug("Attaching editor bridges.", {
        names: servers.map((server) => server.name),
      });
    }
    return servers;
  },
);
