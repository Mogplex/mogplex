import { expect, it } from "vitest";
import type { BranchChanges } from "@/lib/sandbox/branch-changes";
import {
  loadRunChanges,
  readGithubBranchChanges,
  type RunChangesDeps,
} from "./run-changes";

const run = {
  id: "run-1",
  user_id: "user-1",
  repo_id: "repo-1",
  base_branch: "main",
  working_branch: "agent/fix",
  sandbox_record_id: "sbx-record-1",
};

const workspaceChanges: BranchChanges = {
  files: [
    {
      path: "a.ts",
      status: "modified",
      additions: 1,
      deletions: 0,
      patch:
        "@@ -1 +1 @@\n+const key = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';\n",
    },
  ],
  patchTruncated: false,
};

function unexpected(): never {
  throw new Error("unexpected call");
}

function deps(overrides: Partial<RunChangesDeps>): Partial<RunChangesDeps> {
  return {
    loadRepo: unexpected,
    githubToken: unexpected,
    readGithub: unexpected,
    liveWorkspace: async () => null,
    ...overrides,
  };
}

it("should read the live workspace first and redact secrets in its patches", async () => {
  const bases: string[] = [];
  const result = await loadRunChanges(
    run,
    deps({
      liveWorkspace: async (input) => {
        expect(input).toEqual({
          userId: "user-1",
          repoId: "repo-1",
          sandboxRecordId: "sbx-record-1",
          branch: "agent/fix",
        });
        return {
          read: async (base) => {
            bases.push(base);
            return workspaceChanges;
          },
        };
      },
    })
  );

  expect(bases).toEqual(["main"]);
  expect(result.ok && result.changes.source).toBe("workspace");
  expect(result.ok && result.changes.files[0].patch).not.toContain("ghp_");
});

it("should compare the pushed branch on GitHub when the workspace is not running", async () => {
  const result = await loadRunChanges(
    run,
    deps({
      loadRepo: async () => ({ full_name: "acme/app", user_id: "user-1" }),
      githubToken: async () => "token",
      readGithub: async (input) => {
        expect(input).toEqual({
          repoFullName: "acme/app",
          base: "main",
          head: "agent/fix",
          token: "token",
        });
        return { files: [], patchTruncated: false };
      },
    })
  );

  expect(result).toEqual({
    ok: true,
    changes: {
      files: [],
      patchTruncated: false,
      source: "github",
      baseBranch: "main",
      branch: "agent/fix",
      webUrl: "https://github.com/acme/app/compare/main...agent/fix",
    },
  });
});

it("should fall back to GitHub when the workspace read fails", async () => {
  const result = await loadRunChanges(
    run,
    deps({
      liveWorkspace: async () => ({
        read: async () => {
          throw new Error("sandbox stopped");
        },
      }),
      loadRepo: async () => ({ full_name: "acme/app", user_id: "user-1" }),
      githubToken: async () => "token",
      readGithub: async () => null,
    })
  );

  expect(result).toEqual({ ok: false, reason: "not_found" });
});

it("should report no branch for a run that never got one", async () => {
  expect(
    await loadRunChanges({ ...run, working_branch: undefined }, deps({}))
  ).toEqual({ ok: false, reason: "no_branch" });
});

it("should map GitHub compare files and flag omitted patches", async () => {
  const requests: string[] = [];
  const fetchStub = (async (url: string) => {
    requests.push(url);
    return new Response(
      JSON.stringify({
        files: [
          {
            filename: "b.ts",
            previous_filename: "a.ts",
            status: "renamed",
            additions: 0,
            deletions: 0,
          },
          {
            filename: "gone.ts",
            status: "removed",
            additions: 0,
            deletions: 3,
            patch: "@@ -1,3 +0,0 @@",
          },
        ],
      }),
      { status: 200 }
    );
  }) as unknown as typeof fetch;

  const changes = await readGithubBranchChanges(
    {
      repoFullName: "acme/app",
      base: "main",
      head: "agent/fix #2",
      token: "t",
    },
    fetchStub
  );

  expect(requests).toEqual([
    "https://api.github.com/repos/acme/app/compare/main...agent/fix%20%232",
  ]);
  expect(changes).toEqual({
    files: [
      {
        path: "b.ts",
        previousPath: "a.ts",
        status: "renamed",
        additions: 0,
        deletions: 0,
      },
      {
        path: "gone.ts",
        status: "deleted",
        additions: 0,
        deletions: 3,
        patch: "@@ -1,3 +0,0 @@",
      },
    ],
    patchTruncated: true,
  });
});

it("should treat a missing branch on GitHub as no changes found", async () => {
  const fetchStub = (async () =>
    new Response("{}", { status: 404 })) as unknown as typeof fetch;

  expect(
    await readGithubBranchChanges(
      { repoFullName: "acme/app", base: "main", head: "gone", token: "t" },
      fetchStub
    )
  ).toBeNull();
});
