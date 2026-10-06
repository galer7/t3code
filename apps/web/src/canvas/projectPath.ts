import { useCallback } from "react";

import { useActiveProjectTarget } from "~/hooks/useActiveProjectTarget";

/**
 * A file's path from the thread's project root. A file in another repo shows
 * as `repo: path` from that repo's root; any other file keeps its absolute path.
 */
export function useProjectPath(): (path: string, repo?: string) => string {
  const cwd = useActiveProjectTarget()?.cwd ?? null;
  return useCallback(
    (path: string, repo?: string) => {
      if (cwd && path.startsWith(`${cwd}/`)) return path.slice(cwd.length + 1);
      if (repo && path.startsWith(`${repo}/`)) {
        return `${repo.slice(repo.lastIndexOf("/") + 1)}: ${path.slice(repo.length + 1)}`;
      }
      return path;
    },
    [cwd],
  );
}
