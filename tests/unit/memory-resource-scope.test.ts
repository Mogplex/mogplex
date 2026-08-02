import assert from "node:assert/strict";
import test from "node:test";

async function loadMemoryResourceScope() {
  return import("../../lib/memory-resource-scope");
}

test("parseMemoryResourceScope accepts all supported filters", async () => {
  const { parseMemoryResourceScope } = await loadMemoryResourceScope();

  assert.equal(parseMemoryResourceScope(undefined), "all");
  assert.equal(parseMemoryResourceScope(""), "all");
  assert.equal(parseMemoryResourceScope("all"), "all");
  assert.equal(parseMemoryResourceScope("personal"), "personal");
  assert.equal(parseMemoryResourceScope("team"), "team");
  assert.equal(parseMemoryResourceScope("repo"), null);
});

test("resolveMemoryResourceScope resolves team filters through active team membership", async () => {
  const { resolveMemoryResourceScope } = await loadMemoryResourceScope();

  const result = await resolveMemoryResourceScope({
    request: new Request("http://localhost/api/memories"),
    userId: "user-123",
    value: "team",
    resolveProductResourceScope: async () => ({
      ok: true,
      scope: {
        kind: "team",
        userId: "user-123",
        productTeamId: "team-123",
      },
    }),
  });

  assert.deepEqual(result, {
    ok: true,
    filter: "team",
    memoryScope: {
      resourceScope: "team",
      productTeamId: "team-123",
    },
    productScope: {
      kind: "team",
      userId: "user-123",
      productTeamId: "team-123",
    },
  });
});

test("resolveMemoryResourceScope rejects team filters without an active team", async () => {
  const { resolveMemoryResourceScope } = await loadMemoryResourceScope();

  const result = await resolveMemoryResourceScope({
    request: new Request("http://localhost/api/memories"),
    userId: "user-123",
    value: "team",
    resolveProductResourceScope: async () => ({
      ok: true,
      scope: {
        kind: "personal",
        userId: "user-123",
        productTeamId: null,
      },
    }),
  });

  assert.deepEqual(result, {
    ok: false,
    status: 400,
    error: "Team memory scope requires an active team",
  });
});
