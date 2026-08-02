import assert from "node:assert/strict";
import test from "node:test";
import {
  createWorkspaceTree,
  findFirstPaneIdByType,
  type PaneNode,
  updatePaneNode,
} from "../../hooks/use-split-panes";
import { resolvePaneSandboxId } from "../../lib/sandbox/pane-binding";
import { resolvePreviewPaneUrl } from "../../lib/sandbox/preview-url";
import type { SandboxRecord } from "../../lib/types";

function buildSandboxRecord(previewUrl: string | null): SandboxRecord {
  return {
    id: "sandbox-record-1",
    user_id: "user-1",
    repo_id: "repo-1",
    sandbox_id: "sbx_123",
    base_branch: "main",
    working_branch: "main",
    snapshot_id: null,
    stop_reason: null,
    install_log: "",
    dev_log: "",
    runtime: "node22",
    terminal_cwd: null,
    created_at: "2026-04-05T00:00:00.000Z",
    last_active_at: "2026-04-05T00:00:00.000Z",
    billing_summary: {
      source: "platform",
      label: "Mogplex billing",
      project_id: "project-1",
      team_id: null,
      team_label: "Personal",
    },
    runtime_summary: {
      sandbox_id: "sbx_123",
      status: "running",
      health_status: "running",
      preview_url: previewUrl,
      last_health_check_at: "2026-04-05T00:00:00.000Z",
      last_preview_http_status: 200,
      boot_attempts: 1,
      last_boot_started_at: "2026-04-05T00:00:00.000Z",
      last_boot_completed_at: "2026-04-05T00:00:10.000Z",
      vercel_diagnostics: null,
    },
    error_summary: {
      current_error: null,
      last_preview_error: null,
      last_boot_error: null,
      display_error: null,
      has_errors: false,
    },
  };
}

test("resolvePaneSandboxId prefers pinned pane-specific sandbox binding", () => {
  assert.equal(
    resolvePaneSandboxId(
      {
        type: "preview",
        sandboxBinding: "pinned",
        sandboxId: "sandbox-pane",
      },
      "sandbox-session"
    ),
    "sandbox-pane"
  );
});

test("resolvePaneSandboxId falls back to the active session sandbox", () => {
  assert.equal(
    resolvePaneSandboxId(
      {
        type: "preview",
      },
      "sandbox-session"
    ),
    "sandbox-session"
  );
});

test("session-bound preview panes ignore stale pane-local sandbox ids", () => {
  const tree = createWorkspaceTree("acme/demo-app", null);
  const previewPaneId = findFirstPaneIdByType(tree, "preview");
  assert.ok(previewPaneId);

  const previewTree = updatePaneNode(tree, previewPaneId!, {
    sandboxId: "sandbox-stale",
  }) as typeof tree;
  const previewPane = findFirstPaneIdByType(previewTree, "preview");
  assert.ok(previewPane);

  const resolvedSandboxId = resolvePaneSandboxId(
    {
      type: "preview",
      sandboxId: "sandbox-stale",
    } satisfies Pick<PaneNode, "type" | "sandboxId">,
    "sandbox-session"
  );
  const sandboxRecord = buildSandboxRecord(
    "https://preview.current.example.com"
  );

  assert.equal(resolvedSandboxId, "sandbox-session");
  assert.equal(
    resolvePreviewPaneUrl({ type: "preview" }, sandboxRecord),
    "https://preview.current.example.com"
  );
  void previewPane;
});
