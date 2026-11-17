import { describe, expect, it } from "vitest";
import { toSandboxListRecord } from "./response-shaping";
import type { ActiveSandboxRecord } from "./types";

const record: ActiveSandboxRecord = {
  id: "sandbox-record",
  sandbox_id: "provider-runtime",
  repo_id: "repo-1",
  user_id: "owner",
  base_branch: "main",
  working_branch: "feature/signing",
  status: "paused",
  preview_url: null,
  runtime: "node22",
  health_status: "stopped",
  created_at: "2026-11-17T00:00:00Z",
  last_active_at: "2026-11-17T00:00:00Z",
};
describe("sandbox list presentation", () => {
  it.each([
    {
      repos: {
        full_name: "acme/widgets",
        workspaces: { sandbox_timeout_ms: 3600000 },
      },
    },
    {
      repos: [
        {
          full_name: "acme/widgets",
          workspaces: [{ sandbox_timeout_ms: 3600000 }],
        },
      ],
    },
  ])("retains repository identity from a database join", ({ repos }) => {
    const result = toSandboxListRecord({ ...record, repos });
    expect(result.repo).toEqual({ full_name: "acme/widgets" });
    expect(result.id).toBe(record.id);
    expect(result.working_branch).toBe("feature/signing");
    expect(result.runtime_summary.status).toBe("paused");
    expect(result.runtime_summary.effective_timeout_ms).toBe(3600000);
    expect(result).not.toHaveProperty("repos");
  });
  it.each([null, undefined, []].map((repos) => ({ repos })))(
    "handles an absent repository",
    ({ repos }) => {
      expect(toSandboxListRecord({ ...record, repos }).repo).toBeNull();
    }
  );
  it("keeps a missing repository name explicitly unknown", () => {
    expect(toSandboxListRecord({ ...record, repos: {} }).repo).toEqual({
      full_name: null,
    });
  });
});
