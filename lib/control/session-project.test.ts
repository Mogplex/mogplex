import { describe, expect, it } from "vitest";
import {
  canonicalizeControlSessionProjects,
  controlSessionProjectName,
  resolveControlSessionRepo,
  resolveNewSessionRepoId,
} from "./session-project";

const repos = [
  { id: "one", name: "widgets", full_name: "acme/widgets" },
  { id: "two", name: "api", full_name: "acme/api" },
];

describe("durable Control repository identity", () => {
  it("never infers active repository context from a legacy project name", () => {
    for (const session of [
      null,
      { project: "widgets" },
      { project: "acme/widgets", repo_id: null },
    ]) {
      expect(resolveControlSessionRepo(session, repos)).toBeNull();
    }
    expect(
      resolveControlSessionRepo({ repo_id: "one", project: "api" }, repos)
    ).toEqual(repos[0]);
    expect(
      resolveControlSessionRepo(
        { repo_id: "deleted", project: "widgets" },
        repos
      )
    ).toBeNull();
  });

  it("clears unlinked display projects without changing stored session objects", () => {
    const legacy = { project: "acme/widgets", repo_id: null };
    const linked = { project: "acme/api", repo_id: "two" };
    expect(controlSessionProjectName(legacy, repos)).toBeNull();
    expect(
      controlSessionProjectName({ repo_id: "one", project: "widgets" }, repos)
    ).toBe("acme/widgets");
    expect(
      controlSessionProjectName(
        { repo_id: "deleted", project: "old-name" },
        repos
      )
    ).toBe("old-name");
    for (const project of [undefined, null, "", " "]) {
      expect(
        controlSessionProjectName({ repo_id: "deleted", project }, repos)
      ).toBe("Linked repository");
    }
    const result = canonicalizeControlSessionProjects([legacy, linked], repos);
    expect(result).toEqual([{ ...legacy, project: null }, linked]);
    expect(result[1]).toBe(linked);
    expect(legacy.project).toBe("acme/widgets");
  });

  it("still accepts an explicit project target when creating a new mission", () => {
    expect(
      resolveNewSessionRepoId(null, { project: "widgets" }, repos)
    ).toBeNull();
    expect(
      resolveNewSessionRepoId({ project: "widgets", repoId: null }, null, repos)
    ).toBe("one");
    expect(
      resolveNewSessionRepoId(
        { project: "acme/widgets", repoId: null },
        null,
        repos
      )
    ).toBe("one");
    expect(
      resolveNewSessionRepoId({ project: null, repoId: null }, null, repos)
    ).toBeNull();
    expect(
      resolveNewSessionRepoId({ project: "widgets", repoId: null }, null, [
        ...repos,
        { id: "three", full_name: "other/widgets" },
      ])
    ).toBeNull();
    expect(
      resolveNewSessionRepoId({ project: "missing", repoId: null }, null, repos)
    ).toBeNull();
  });
});
