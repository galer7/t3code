/**
 * Draw-out: a repo's areas, the parts of its architecture a card can belong
 * to, such as one app, one service or one deployment unit. A repo lists them
 * in `.draw-out/areas.json`; each area matches files by path globs from the
 * repo root, and its colour and label mark every card in it. A card in no
 * area falls back to its lane.
 *
 * {
 *   "areas": [
 *     { "id": "patient-app", "label": "Patient app", "color": "#60a5fa",
 *       "paths": ["apps/patient-app/**"] }
 *   ]
 * }
 */
import type { CanvasCardRecord } from "@t3tools/contracts";

import { LANE_STYLES } from "./laneStyles";

export interface Area {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  readonly paths: readonly string[];
}

export interface CardStyle {
  readonly label: string;
  readonly color: string;
}

/** Colours for areas that name none, in order. */
const PALETTE = [
  "#60a5fa",
  "#a78bfa",
  "#34d399",
  "#f59e0b",
  "#f472b6",
  "#22d3ee",
  "#fb7185",
  "#a3e635",
  "#c084fc",
  "#fbbf24",
];

/** A path glob as a regular expression: `**` crosses folders, `*` and `?` do not. */
export function globToRegExp(glob: string): RegExp {
  let source = "";
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index]!;
    if (char === "*" && glob[index + 1] === "*") {
      const slash = glob[index + 2] === "/";
      source += slash ? "(?:.*/)?" : ".*";
      index += slash ? 2 : 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}

export function parseAreas(contents: string): Area[] {
  try {
    const value = JSON.parse(contents) as { areas?: unknown };
    if (!Array.isArray(value.areas)) return [];
    return value.areas.flatMap((raw, index) => {
      const area = raw as Partial<Area>;
      if (typeof area.label !== "string" || !Array.isArray(area.paths)) return [];
      return [
        {
          id: typeof area.id === "string" ? area.id : area.label,
          label: area.label,
          color: typeof area.color === "string" ? area.color : PALETTE[index % PALETTE.length]!,
          paths: area.paths.filter((path): path is string => typeof path === "string"),
        },
      ];
    });
  } catch {
    return [];
  }
}

/** The area of a file, by its path from the repo root: the first area that matches. */
export function areaOf(areas: readonly Area[], relativePath: string): Area | null {
  return (
    areas.find((area) => area.paths.some((glob) => globToRegExp(glob).test(relativePath))) ?? null
  );
}

/** The repo root a card's file is in: its recorded repo, else the thread's folder. */
export function repoRootOf(card: CanvasCardRecord, cwd: string | null): string | null {
  if (card.repo) return card.repo;
  if (cwd && card.path.startsWith(`${cwd}/`)) return cwd;
  return null;
}

/** A card's colour and label: its area's when it has one, else its lane's. */
export function cardStyle(
  card: CanvasCardRecord,
  areasByRoot: ReadonlyMap<string, readonly Area[]>,
  cwd: string | null,
): CardStyle {
  const root = repoRootOf(card, cwd);
  const area =
    root && card.path.startsWith(`${root}/`)
      ? areaOf(areasByRoot.get(root) ?? [], card.path.slice(root.length + 1))
      : null;
  return area ?? LANE_STYLES[card.lane];
}
