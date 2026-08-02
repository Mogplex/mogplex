import assert from "node:assert/strict";
import test from "node:test";
import { resolvePreviewPaneUrl } from "../../lib/sandbox/preview-url";
import type { SandboxRecord } from "../../lib/types";

function buildSandboxRecord(
  previewUrl: string | null,
  overrides: { status?: string; health_status?: string } = {}
): SandboxRecord {
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
      status: overrides.status ?? "running",
      health_status: overrides.health_status ?? "running",
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

test("resolvePreviewPaneUrl reads the live sandbox preview url for preview panes", () => {
  const result = resolvePreviewPaneUrl(
    { type: "preview" },
    buildSandboxRecord("https://preview.current.example.com")
  );

  assert.equal(result, "https://preview.current.example.com");
});

test("resolvePreviewPaneUrl ignores editor-only pane metadata for preview panes", () => {
  const result = resolvePreviewPaneUrl(
    { type: "preview" },
    buildSandboxRecord("https://preview.new.example.com")
  );

  assert.notEqual(result, "https://preview.old.example.com");
  assert.equal(result, "https://preview.new.example.com");
});

test("resolvePreviewPaneUrl returns undefined for non-preview panes", () => {
  const result = resolvePreviewPaneUrl(
    { type: "editor" },
    buildSandboxRecord("https://preview.current.example.com")
  );

  assert.equal(result, undefined);
});

test("resolvePreviewPaneUrl returns the URL while the dev server is still starting", () => {
  const result = resolvePreviewPaneUrl(
    { type: "preview" },
    buildSandboxRecord("https://preview.starting.example.com", {
      status: "running",
      health_status: "starting",
    })
  );

  assert.equal(result, "https://preview.starting.example.com");
});

test("resolvePreviewPaneUrl returns undefined when the starting sandbox has no preview URL yet", () => {
  const result = resolvePreviewPaneUrl(
    { type: "preview" },
    buildSandboxRecord(null, { status: "running", health_status: "starting" })
  );

  assert.equal(result, undefined);
});

test("resolvePreviewPaneUrl hides the URL during boot to avoid 502s on the iframe", () => {
  const result = resolvePreviewPaneUrl(
    { type: "preview" },
    buildSandboxRecord("https://preview.booting.example.com", {
      status: "installing",
    })
  );

  assert.equal(result, undefined);
});

test("resolvePreviewPaneUrl hides the URL for paused, stopped, and errored sandboxes", () => {
  for (const status of ["paused", "stopped", "error"]) {
    const result = resolvePreviewPaneUrl(
      { type: "preview" },
      buildSandboxRecord("https://preview.terminal.example.com", { status })
    );

    assert.equal(result, undefined, `expected undefined for status=${status}`);
  }
});

test("resolvePreviewPaneUrl returns undefined when there is no sandbox record", () => {
  const result = resolvePreviewPaneUrl({ type: "preview" }, null);

  assert.equal(result, undefined);
});
