import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { type Area, parseAreas } from "./areas";
import { readServerFile } from "./lsp";

/** Each repo's areas, read from its `.draw-out/areas.json` on the server's machine. */
export function useAreas(
  environmentId: EnvironmentId,
  roots: readonly string[],
): ReadonlyMap<string, readonly Area[]> {
  const [areas, setAreas] = useState<ReadonlyMap<string, readonly Area[]>>(new Map());
  const key = [...new Set(roots)].toSorted().join("\n");
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      key
        .split("\n")
        .filter(Boolean)
        .map(async (root) => {
          const contents = await readServerFile(environmentId, `${root}/.draw-out/areas.json`);
          return [root, contents ? parseAreas(contents) : []] as const;
        }),
    ).then((entries) => {
      if (!cancelled) setAreas(new Map(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [environmentId, key]);
  return areas;
}
