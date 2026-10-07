import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { pickIndexLandingProject, validateChatIndexSearch } from "./chatIndexSearch";

const primary = EnvironmentId.make("env-primary");
const remote = EnvironmentId.make("env-remote");
const project = (environmentId: EnvironmentId, id: string) => ({
  environmentId,
  id: ProjectId.make(id),
});

describe("validateChatIndexSearch", () => {
  it("keeps a non-empty project id and drops everything else", () => {
    expect(validateChatIndexSearch({ project: " p-1 ", token: "secret" })).toEqual({
      project: "p-1",
    });
    expect(validateChatIndexSearch({ project: "  " })).toEqual({});
    expect(validateChatIndexSearch({ project: 42 })).toEqual({});
  });
});

describe("pickIndexLandingProject", () => {
  const sorted = [
    project(primary, "recent"),
    project(remote, "wanted"),
    project(primary, "wanted"),
  ];

  it("opens the requested project in the primary environment", () => {
    expect(pickIndexLandingProject(sorted, ProjectId.make("wanted"), primary)).toBe(sorted[2]);
  });

  it("falls back to the most recent project for an unknown or missing id", () => {
    expect(pickIndexLandingProject(sorted, ProjectId.make("gone"), primary)).toBe(sorted[0]);
    expect(pickIndexLandingProject(sorted, undefined, primary)).toBe(sorted[0]);
    expect(pickIndexLandingProject(sorted, ProjectId.make("wanted"), null)).toBe(sorted[0]);
    expect(pickIndexLandingProject([], ProjectId.make("wanted"), primary)).toBeNull();
  });
});
