import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSandboxObservabilityHref,
  navigateToSandboxHealth,
} from "../../lib/sandbox/navigation";
import type { Repo } from "../../lib/types";

function buildRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: "repo-1",
    user_id: "user-1",
    full_name: "acme/demo-app",
    created_at: "2026-04-01T00:00:00.000Z",
    ...overrides,
  };
}

test("buildSandboxObservabilityHref builds repo-only and exact sandbox URLs", () => {
  assert.equal(
    buildSandboxObservabilityHref({ scope: "acme", repoId: "repo-1" }),
    "/acme/observability?repo_id=repo-1"
  );
  assert.equal(
    buildSandboxObservabilityHref({
      scope: "acme",
      repoId: "repo-1",
      sandboxRecordId: "sandbox-record-1",
    }),
    "/acme/observability?repo_id=repo-1&sandbox_record_id=sandbox-record-1"
  );
});

test("navigateToSandboxHealth opens the matching repo health tab and routes home", () => {
  const repo = buildRepo();
  const opened: Array<{
    repo: Repo;
    options?: { previewTab?: string; focusPaneType?: string };
  }> = [];
  const pushed: string[] = [];

  const success = navigateToSandboxHealth({
    scope: "acme",
    repoId: repo.id,
    repos: [repo],
    openWorkspaceSession: (nextRepo, options) => {
      opened.push({ repo: nextRepo, options });
      return "session-1";
    },
    router: {
      push(href) {
        pushed.push(href);
      },
    },
  });

  assert.equal(success, true);
  assert.deepEqual(opened, [
    {
      repo,
      options: {
        previewTab: "health",
        focusPaneType: "preview",
      },
    },
  ]);
  assert.deepEqual(pushed, ["/acme/projects/workspace"]);
});

test("navigateToSandboxHealth preserves an explicit sandbox target when provided", () => {
  const repo = buildRepo();
  const opened: Array<{ repo: Repo; options?: Record<string, string> }> = [];

  navigateToSandboxHealth({
    scope: "acme",
    repoId: repo.id,
    sandboxRecordId: "sandbox-42",
    repos: [repo],
    openWorkspaceSession: (nextRepo, options) => {
      opened.push({
        repo: nextRepo,
        options: options as Record<string, string>,
      });
      return "session-1";
    },
    router: {
      push() {},
    },
  });

  assert.deepEqual(opened, [
    {
      repo,
      options: {
        previewTab: "health",
        focusPaneType: "preview",
        sandboxId: "sandbox-42",
      },
    },
  ]);
});

test("navigateToSandboxHealth returns false when repo resolution fails", () => {
  const opened: string[] = [];
  const pushed: string[] = [];

  const success = navigateToSandboxHealth({
    scope: "acme",
    repoId: "missing",
    repos: [buildRepo()],
    openWorkspaceSession: () => {
      opened.push("opened");
      return "session-1";
    },
    router: {
      push(href) {
        pushed.push(href);
      },
    },
  });

  assert.equal(success, false);
  assert.deepEqual(opened, []);
  assert.deepEqual(pushed, []);
});
