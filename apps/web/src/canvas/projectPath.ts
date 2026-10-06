import { useCallback } from "react";

import { useActiveProjectTarget } from "~/hooks/useActiveProjectTarget";

/** A file's path from the thread's project root, or the absolute path outside it. */
export function useProjectPath(): (path: string) => string {
  const cwd = useActiveProjectTarget()?.cwd ?? null;
  return useCallback(
    (path: string) => (cwd && path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path),
    [cwd],
  );
}
