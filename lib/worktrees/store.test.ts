import { describe, expect, it } from "vitest";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  buildReservedCheckoutPath,
  isReservedCheckoutPath,
  isStaleWorktreeReservation,
  reserveWorktree,
  staleWorktreeReservationCutoff,
} from "./store";

describe("staleWorktreeReservationCutoff", () => {
  it("allows a creating reservation to be reclaimed after five minutes", () => {
    expect(
      staleWorktreeReservationCutoff(Date.parse("2026-08-13T00:05:00.000Z"))
    ).toBe("2026-08-13T00:00:00.000Z");
    expect(
      isStaleWorktreeReservation(
        "2026-08-12T23:59:59.999Z",
        Date.parse("2026-08-13T00:05:00.000Z")
      )
    ).toBe(true);
  });

  it("builds a constraint-safe placeholder with a repository path segment", () => {
    expect(
      buildReservedCheckoutPath("11111111-2222-4333-8444-555555555555")
    ).toBe("/.reserved/.worktrees/11111111-2222-4333-8444-555555555555");
    expect(
      isReservedCheckoutPath(
        "/.reserved/.worktrees/11111111-2222-4333-8444-555555555555"
      )
    ).toBe(true);
  });

  it("returns the winning reservation for service-level conflict mapping", async () => {
    const winner = {
      id: "11111111-2222-4333-8444-555555555555",
      user_id: "00000000-0000-4000-8000-00000000000a",
      run_id: "22222222-2222-4222-8222-222222222222",
      task_id: "33333333-3333-4333-8333-333333333333",
      repo_id: "44444444-4444-4444-8444-444444444444",
      sandbox_id: "66666666-6666-4666-8666-666666666666",
      agent_id: null,
      branch_name: "mogplex/task/fix-login",
      base_branch: "main",
      checkout_path:
        "/.reserved/.worktrees/11111111-2222-4333-8444-555555555555",
      status: "creating",
      latest_commit_sha: null,
      error: null,
      metadata: {},
      created_at: "2026-08-13T00:00:00.000Z",
      updated_at: "2026-08-13T00:00:00.000Z",
      archived_at: null,
      pruned_at: null,
    };
    let call = 0;
    const query = {
      insert: () => query,
      select: () => query,
      single: async () => ({
        data: null,
        error: { code: "23505", message: "duplicate key" },
      }),
      eq: () => query,
      neq: () => query,
      maybeSingle: async () => ({ data: winner, error: null }),
    };
    Object.defineProperty(supabaseAdmin, "from", {
      configurable: true,
      writable: true,
      value: () => {
        call += 1;
        return query;
      },
    });
    try {
      await expect(
        reserveWorktree({
          userId: winner.user_id,
          runId: winner.run_id,
          taskId: winner.task_id,
          repoId: winner.repo_id,
          sandboxId: "55555555-5555-4555-8555-555555555555",
          agentId: null,
          branchName: winner.branch_name,
          baseBranch: winner.base_branch,
        })
      ).resolves.toEqual({ worktree: winner, created: false });
      expect(call).toBe(2);
    } finally {
      Reflect.deleteProperty(supabaseAdmin, "from");
    }
  });
});
