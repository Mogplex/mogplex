import assert from "node:assert/strict";
import { test } from "vitest";
import { NextResponse } from "next/server";
import { createMergeSettingsHandlers } from "@/lib/github-merge-policy-handlers";

test("retired merge settings and approval endpoints return 410 for team members", async () => {
  const handlers = createMergeSettingsHandlers({
    requireProfileId: async () => "user",
    loadTeamMembershipAuth: async () => ({
      ok: true,
      role: "developer",
      canManage: false,
    }),
  });
  const request = new Request("https://mogplex.test/api", { method: "POST" });
  for (const response of await Promise.all([
    handlers.get("team"),
    handlers.patch(request, "team"),
    handlers.resolve(request, "team", "approval"),
  ])) {
    assert.equal(response.status, 410);
    assert.match((await response.json()).error, /settings have been removed/);
  }
});

test("retired endpoints still require authentication and team membership", async () => {
  const unauthenticated = createMergeSettingsHandlers({
    requireProfileId: async () =>
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    loadTeamMembershipAuth: async () => {
      throw new Error("Must authenticate first");
    },
  });
  assert.equal((await unauthenticated.get("team")).status, 401);
  const outsider = createMergeSettingsHandlers({
    requireProfileId: async () => "user",
    loadTeamMembershipAuth: async () => ({
      ok: false,
      error: "Forbidden",
      status: 403,
    }),
  });
  assert.equal((await outsider.get("team")).status, 403);
});
