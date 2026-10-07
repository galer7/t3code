import { type EnvironmentId, ProjectId } from "@t3tools/contracts";

/**
 * Search params for `/`. `project` names a project in the primary environment
 * that the index route opens a draft in, for clients that frame the app on a
 * given project. `/pair` accepts it too and carries it through to `/`.
 */
export interface ChatIndexSearch {
  readonly project?: ProjectId;
}

export function validateChatIndexSearch(raw: Record<string, unknown>): ChatIndexSearch {
  return typeof raw.project === "string" && raw.project.trim()
    ? { project: ProjectId.make(raw.project.trim()) }
    : {};
}

/**
 * Picks the project the index route drafts in: the requested primary
 * environment project when it exists, otherwise the first of `sortedProjects`.
 */
export function pickIndexLandingProject<
  TProject extends { readonly environmentId: EnvironmentId; readonly id: ProjectId },
>(
  sortedProjects: readonly TProject[],
  requestedProjectId: ProjectId | undefined,
  primaryEnvironmentId: EnvironmentId | null,
): TProject | null {
  const requested =
    requestedProjectId === undefined || primaryEnvironmentId === null
      ? undefined
      : sortedProjects.find(
          (project) =>
            project.environmentId === primaryEnvironmentId && project.id === requestedProjectId,
        );
  return requested ?? sortedProjects[0] ?? null;
}
