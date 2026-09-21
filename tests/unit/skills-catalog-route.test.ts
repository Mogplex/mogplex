import assert from "node:assert/strict";
import test from "node:test";
import type { SkillCatalog } from "../../lib/skill-catalog/types";

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";

const REPO = "00000000-0000-4000-8000-000000000601";

const CATALOG: SkillCatalog = {
  skills: [
    {
      id: "s1",
      slug: "deploy-checklist",
      name: "Deploy checklist",
      description: "Before shipping",
      content: "1. Run the tests.",
      tags: ["release"],
      source: "library",
    },
  ],
};

async function loadRoute() {
  return import("../../app/api/skills/catalog/route");
}

test("GET /api/skills/catalog returns handles without instructions for the signed-in user", async () => {
  const { createSkillCatalogGetHandler } = await loadRoute();
  const calls: unknown[] = [];
  const handler = createSkillCatalogGetHandler({
    requireUserId: async () => "user-1",
    loadCatalog: async (input) => {
      calls.push(input);
      return CATALOG;
    },
  });

  const response = await handler(
    new Request(`http://localhost/api/skills/catalog?repoId=${REPO}`)
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    skills: [
      {
        id: "s1",
        slug: "deploy-checklist",
        name: "Deploy checklist",
        description: "Before shipping",
        source: "library",
      },
    ],
  });
  assert.deepEqual(calls, [{ userId: "user-1", repoId: REPO }]);

  await handler(new Request("http://localhost/api/skills/catalog"));
  assert.deepEqual(calls[1], { userId: "user-1", repoId: null });
});

test("GET /api/skills/catalog turns away a signed-out caller before touching the catalog", async () => {
  const { createSkillCatalogGetHandler } = await loadRoute();
  let loaded = false;
  const handler = createSkillCatalogGetHandler({
    requireUserId: async () =>
      Response.json({ error: "Unauthorized" }, { status: 401 }) as never,
    loadCatalog: async () => {
      loaded = true;
      return CATALOG;
    },
  });
  const response = await handler(
    new Request("http://localhost/api/skills/catalog")
  );
  assert.equal(response.status, 401);
  assert.equal(loaded, false);
});

test("GET /api/skills/catalog rejects a malformed repo id and hides a failed read", async () => {
  const { createSkillCatalogGetHandler } = await loadRoute();
  const originalError = console.error;
  console.error = () => {};
  try {
    const handler = createSkillCatalogGetHandler({
      requireUserId: async () => "user-1",
      loadCatalog: async () => {
        throw new Error("relation skills does not exist");
      },
    });
    const invalid = await handler(
      new Request("http://localhost/api/skills/catalog?repoId=repo-1")
    );
    assert.equal(invalid.status, 400);

    const failed = await handler(
      new Request("http://localhost/api/skills/catalog")
    );
    assert.equal(failed.status, 500);
    assert.deepEqual(await failed.json(), { error: "Failed to load skills" });
  } finally {
    console.error = originalError;
  }
});
