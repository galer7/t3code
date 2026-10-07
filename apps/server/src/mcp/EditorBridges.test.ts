import { describe, expect, it } from "vite-plus/test";
import { selectEditorBridges, type EditorBridgeCandidate } from "./EditorBridges.ts";

const bridge = (overrides: Record<string, unknown> = {}) => ({
  version: 1,
  name: "draw-out",
  url: "http://127.0.0.1:4100/mcp",
  pid: 100,
  workspaceFolders: ["/work/app"],
  ...overrides,
});

const select = (
  candidates: ReadonlyArray<EditorBridgeCandidate>,
  options: { cwd?: string; alive?: ReadonlyArray<number> } = {},
) => {
  const alive = new Set(options.alive ?? [100, 200, 300]);
  return selectEditorBridges({
    candidates,
    cwd: options.cwd ?? "/work/app",
    threadId: "thread-1",
    isPidAlive: (pid) => alive.has(pid),
  });
};

describe("selectEditorBridges", () => {
  it("attaches a live bridge for the session folder and names the calling thread", () => {
    const { servers } = select([{ path: "a.json", content: bridge() }]);
    expect(servers).toEqual([
      {
        name: "draw-out",
        url: "http://127.0.0.1:4100/mcp",
        headers: { "X-T3-Thread-Id": "thread-1" },
      },
    ]);
  });

  it("matches a cwd inside the folder and a folder inside the cwd, but not a sibling", () => {
    const candidates = [{ path: "a.json", content: bridge() }];
    expect(select(candidates, { cwd: "/work/app/packages/web" }).servers).toHaveLength(1);
    expect(select(candidates, { cwd: "/work" }).servers).toHaveLength(1);
    expect(select(candidates, { cwd: "/work/app-other" }).servers).toHaveLength(0);
    expect(select(candidates, { cwd: "/elsewhere" }).servers).toHaveLength(0);
  });

  it("drops a bridge whose editor process has exited", () => {
    const { servers, rejected } = select([{ path: "a.json", content: bridge() }], { alive: [] });
    expect(servers).toEqual([]);
    expect(rejected).toEqual([{ path: "a.json", reason: "process 100 is not running" }]);
  });

  it("keeps the bridge with the longest matching folder when names collide", () => {
    const { servers, rejected } = select(
      [
        {
          path: "outer.json",
          content: bridge({ pid: 200, url: "http://127.0.0.1:1/mcp", workspaceFolders: ["/work"] }),
        },
        { path: "inner.json", content: bridge({ pid: 300, url: "http://127.0.0.1:2/mcp" }) },
        {
          path: "deep.json",
          content: bridge({ url: "http://127.0.0.1:3/mcp", workspaceFolders: ["/elsewhere"] }),
        },
      ],
      { cwd: "/work/app/src" },
    );
    expect(servers.map((server) => server.url)).toEqual(["http://127.0.0.1:2/mcp"]);
    expect(rejected.map((entry) => entry.path).toSorted()).toEqual(["deep.json", "outer.json"]);
  });

  it("sanitizes names and keeps differently named bridges side by side", () => {
    const { servers } = select([
      { path: "a.json", content: bridge({ name: "draw out!" }) },
      { path: "b.json", content: bridge({ name: "other", pid: 200 }) },
    ]);
    expect(servers.map((server) => server.name)).toEqual(["draw_out_", "other"]);
  });

  it("ignores invalid files without failing the rest", () => {
    const { servers, rejected } = select([
      { path: "unreadable.json", content: undefined },
      { path: "version.json", content: bridge({ version: 2 }) },
      { path: "pid.json", content: bridge({ pid: "100" }) },
      { path: "remote.json", content: bridge({ url: "http://example.com:4100/mcp" }) },
      { path: "scheme.json", content: bridge({ url: "file:///tmp/mcp" }) },
      { path: "reserved.json", content: bridge({ name: "t3-code" }) },
      { path: "relative.json", content: bridge({ workspaceFolders: ["work/app"] }) },
      { path: "good.json", content: bridge({ url: "http://localhost:4100/mcp" }) },
    ]);
    expect(servers.map((server) => server.url)).toEqual(["http://localhost:4100/mcp"]);
    expect(rejected).toHaveLength(7);
  });
});
