import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SandboxRecord } from "../../lib/types";
import type { OrchestrationWorktreeDTO } from "../../lib/worktrees/types";
import { WorkspaceTabs } from "../../components/control/workspace-tabs";
import { WorktreesPanel } from "../../components/control/worktrees-panel";
import { SandboxesPanel } from "../../components/control/sandboxes-panel";

const sandbox = {
  id: "sandbox-record-1",
  repo_id: "repo-1",
  working_branch: "feat/compute-context",
  runtime_summary: {
    sandbox_id: "sbx_runtime123",
    status: "running",
  },
} as SandboxRecord;

const worktree = {
  id: "worktree-1",
  task_id: "task-1",
  sandbox_id: sandbox.id,
  branch_name: "mogplex/task/task-1",
  base_branch: "main",
  checkout_path: "/vercel/sandbox/.worktrees/worktree-1",
  status: "active",
  agent_id: null,
  error: null,
  updated_at: new Date().toISOString(),
} as OrchestrationWorktreeDTO;

test("Control resource tabs expose distinct counts and selected compute context", () => {
  const html = renderToStaticMarkup(
    createElement(WorkspaceTabs, {
      view: "chat",
      onViewChange: () => undefined,
      sandboxes: [sandbox],
      worktrees: [worktree],
      selectedSandboxId: sandbox.id,
      onFocusSandbox: () => undefined,
    })
  );

  assert.match(html, /role="tablist"/);
  assert.match(html, /aria-label="Control views"/);
  assert.match(html, /Worktrees, 1 checkout/);
  assert.match(html, /Sandboxes, 1 current sandbox, 0 previous attempts/);
  assert.match(
    html,
    /Select sandbox sbx_runtime123, Running, repository branch feat\/compute-context, for chat and preview/
  );
  assert.match(html, />sbx_runtime123</);
});

test("Worktree panel teaches task checkout identity without compute actions", () => {
  const html = renderToStaticMarkup(
    createElement(WorktreesPanel, {
      worktrees: [worktree],
      loading: false,
      error: null,
      onRefresh: async () => undefined,
      onAction: async () => undefined,
      onDiff: async () => "",
    })
  );

  assert.match(html, /Task-specific Git checkouts inside sandbox compute/);
  assert.match(html, /Worktree for task task-1/);
  assert.match(html, /Runs in sandbox/);
  assert.match(html, /mogplex\/task\/task-1/);
  assert.doesNotMatch(html, /Start sandbox|Stop sandbox|Restart sandbox/);
});

test("Worktree panel keeps the model visible in loading, error, and empty states", () => {
  const loadingHtml = renderToStaticMarkup(
    createElement(WorktreesPanel, {
      worktrees: [],
      loading: true,
      error: null,
      onRefresh: async () => undefined,
      onAction: async () => undefined,
      onDiff: async () => "",
    })
  );
  assert.match(loadingHtml, /Loading worktree checkouts/);
  assert.match(
    loadingHtml,
    /Task-specific Git checkouts inside sandbox compute/
  );

  const errorHtml = renderToStaticMarkup(
    createElement(WorktreesPanel, {
      worktrees: [],
      loading: false,
      error: "Could not load worktrees",
      onRefresh: async () => undefined,
      onAction: async () => undefined,
      onDiff: async () => "",
    })
  );
  assert.match(errorHtml, /Could not load worktrees/);
  assert.match(errorHtml, /No worktrees yet/);
});

test("Sandbox panel keeps the compute model visible while loading and empty", () => {
  const loadingHtml = renderToStaticMarkup(
    createElement(SandboxesPanel, {
      sandboxes: [],
      loading: true,
      hasRepository: true,
      selectedSandboxId: null,
      focusSandboxId: null,
      onClearFocus: () => undefined,
      onSelectSandbox: () => undefined,
      onStartSandbox: () => undefined,
    })
  );
  assert.match(loadingHtml, /Loading sandbox compute/);
  assert.match(loadingHtml, /Remote compute for commands and previews/);

  const emptyHtml = renderToStaticMarkup(
    createElement(SandboxesPanel, {
      sandboxes: [],
      loading: false,
      hasRepository: true,
      selectedSandboxId: null,
      focusSandboxId: null,
      onClearFocus: () => undefined,
      onSelectSandbox: () => undefined,
      onStartSandbox: () => undefined,
    })
  );
  assert.match(emptyHtml, /No current sandbox/);
  assert.match(emptyHtml, /Starting compute alone does not create a worktree/);
});
