import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { handleMogplexMcpPayload } from "../../lib/mogplex-api/mcp";
import type { SkillCatalog } from "../../lib/skill-catalog/types";
import {
  assertSingleMcpResponse,
  buildFakeMcpClient,
} from "./helpers/mogplex-api-mcp-fixtures";

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";

const REPO = "00000000-0000-4000-8000-000000000501";

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
    {
      id: "s2",
      slug: "release-notes",
      name: "Release notes",
      description: null,
      content: "Group changes by area.",
      tags: [],
      source: "repo",
    },
  ],
};

function readKey(scopes: string[] = ["read"]) {
  return async () => ({
    ok: true as const,
    auth: { userId: "user-123", keyId: "key-1", scopes },
  });
}

function get(path: string, authorized = true) {
  return new NextRequest(`http://localhost${path}`, {
    headers: authorized ? { authorization: "Bearer mog_test" } : {},
  });
}

test("listMogplexApiSkills returns summaries without instructions, ranked by the query", async () => {
  const { listMogplexApiSkills } = await import("../../lib/mogplex-api/skills");
  const calls: unknown[] = [];
  const loadCatalog = async (input: unknown) => {
    calls.push(input);
    return CATALOG;
  };
  const all = await listMogplexApiSkills(
    { userId: "user-123" },
    { loadCatalog }
  );
  assert.equal(all.total, 2);
  assert.deepEqual(
    all.skills.map((skill) => skill.slug),
    ["deploy-checklist", "release-notes"]
  );
  assert.equal("content" in all.skills[0], false);

  const found = await listMogplexApiSkills(
    { userId: "user-123", repoId: REPO, query: "changelog notes", limit: 1 },
    { loadCatalog }
  );
  assert.deepEqual(found, {
    total: 2,
    skills: [
      {
        slug: "release-notes",
        name: "Release notes",
        description: null,
        tags: [],
        source: "repo",
      },
    ],
  });
  assert.deepEqual(calls, [
    { userId: "user-123", repoId: null },
    { userId: "user-123", repoId: REPO },
  ]);
});

test("getMogplexApiSkill resolves a slug typed any way and returns null for an unknown one", async () => {
  const { getMogplexApiSkill } = await import("../../lib/mogplex-api/skills");
  const deps = { loadCatalog: async () => CATALOG };
  const skill = await getMogplexApiSkill(
    { userId: "user-123", slug: "$Deploy_Checklist" },
    deps
  );
  assert.equal(skill?.content, "1. Run the tests.");
  assert.equal(skill?.slug, "deploy-checklist");
  assert.equal(
    await getMogplexApiSkill({ userId: "user-123", slug: "nope" }, deps),
    null
  );
});

test("GET /api/v1/mogplex/skills lists skills for a read-scoped key", async () => {
  const { createMogplexApiSkillsGetHandler } =
    await import("../../app/api/v1/mogplex/skills/route");
  const calls: unknown[] = [];
  const handler = createMogplexApiSkillsGetHandler({
    resolveApiKey: readKey(),
    listSkills: async (input) => {
      calls.push(input);
      return { skills: [], total: 0 };
    },
  });
  const response = await handler(
    get(`/api/v1/mogplex/skills?q=deploy&repoId=${REPO}&limit=5`)
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    data: { skills: [], total: 0 },
  });
  assert.deepEqual(calls, [
    { userId: "user-123", repoId: REPO, query: "deploy", limit: 5 },
  ]);
});

test("GET /api/v1/mogplex/skills rejects a missing token, a missing scope, and bad input", async () => {
  const { createMogplexApiSkillsGetHandler } =
    await import("../../app/api/v1/mogplex/skills/route");
  let listed = 0;
  const listSkills = async () => {
    listed += 1;
    return { skills: [], total: 0 };
  };

  const anonymous = await createMogplexApiSkillsGetHandler({
    resolveApiKey: readKey(),
    listSkills,
  })(get("/api/v1/mogplex/skills", false));
  assert.equal(anonymous.status, 401);

  const unscoped = await createMogplexApiSkillsGetHandler({
    resolveApiKey: readKey(["write"]),
    listSkills,
  })(get("/api/v1/mogplex/skills"));
  assert.equal(unscoped.status, 403);

  const handler = createMogplexApiSkillsGetHandler({
    resolveApiKey: readKey(),
    listSkills,
  });
  for (const query of ["repoId=not-a-uuid", "limit=0", "limit=9999"]) {
    const response = await handler(get(`/api/v1/mogplex/skills?${query}`));
    assert.equal(response.status, 400, query);
    assert.equal((await response.json()).error.code, "BAD_REQUEST");
  }
  assert.equal(listed, 0);
});

test("GET /api/v1/mogplex/skills hides the cause of a failed read", async () => {
  const { createMogplexApiSkillsGetHandler } =
    await import("../../app/api/v1/mogplex/skills/route");
  const originalError = console.error;
  console.error = () => {};
  try {
    const response = await createMogplexApiSkillsGetHandler({
      resolveApiKey: readKey(),
      listSkills: async () => {
        throw new Error("relation skills does not exist");
      },
    })(get("/api/v1/mogplex/skills"));
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to list skills" },
    });
  } finally {
    console.error = originalError;
  }
});

test("GET /api/v1/mogplex/skills/[slug] returns one skill, 404s an unknown slug, and checks auth", async () => {
  const { createMogplexApiSkillGetHandler } =
    await import("../../app/api/v1/mogplex/skills/[slug]/route");
  const calls: unknown[] = [];
  const handler = createMogplexApiSkillGetHandler({
    resolveApiKey: readKey(),
    getSkill: async (input) => {
      calls.push(input);
      return input.slug === "deploy-checklist"
        ? {
            slug: "deploy-checklist",
            name: "Deploy checklist",
            description: null,
            tags: [],
            source: "library" as const,
            content: "1. Run the tests.",
          }
        : null;
    },
  });
  const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

  const found = await handler(
    get(`/api/v1/mogplex/skills/deploy-checklist?repoId=${REPO}`),
    params("deploy-checklist")
  );
  assert.equal(found.status, 200);
  assert.equal((await found.json()).data.skill.content, "1. Run the tests.");
  assert.deepEqual(calls, [
    { userId: "user-123", slug: "deploy-checklist", repoId: REPO },
  ]);

  const missing = await handler(
    get("/api/v1/mogplex/skills/nope"),
    params("nope")
  );
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, "NOT_FOUND");

  const invalid = await handler(
    get("/api/v1/mogplex/skills/x?repoId=bad"),
    params("x")
  );
  assert.equal(invalid.status, 400);

  const anonymous = await handler(
    get("/api/v1/mogplex/skills/deploy-checklist", false),
    params("deploy-checklist")
  );
  assert.equal(anonymous.status, 401);
});

test("Mogplex MCP lists skills and reads one through the API client", async () => {
  const seen: unknown[] = [];
  const client = buildFakeMcpClient({
    listSkills: async (input) => {
      seen.push(input);
      return {
        total: 4,
        skills: [
          {
            slug: "deploy-checklist",
            name: "Deploy checklist",
            description: null,
            tags: [],
            source: "library",
          },
        ],
      };
    },
    getSkill: async (input) => {
      seen.push(input);
      return {
        skill: {
          slug: "deploy-checklist",
          name: "Deploy checklist",
          description: null,
          tags: [],
          source: "library",
          content: "1. Run the tests.",
        },
      };
    },
  });
  const call = (name: string, args: Record<string, unknown>) =>
    handleMogplexMcpPayload(
      {
        jsonrpc: "2.0",
        id: name,
        method: "tools/call",
        params: { name, arguments: args },
      },
      { client }
    );

  const listed = assertSingleMcpResponse(
    await call("mogplex_list_skills", { query: "deploy", repoId: REPO })
  ) as {
    result: {
      content: Array<{ text: string }>;
      structuredContent: { total: number };
    };
  };
  assert.equal(listed.result.structuredContent.total, 4);
  assert.ok(
    listed.result.content[0].text.includes("Found 1 of 4 Mogplex skills.")
  );

  const loaded = assertSingleMcpResponse(
    await call("mogplex_get_skill", { slug: "deploy-checklist" })
  ) as { result: { structuredContent: { skill: { content: string } } } };
  assert.equal(
    loaded.result.structuredContent.skill.content,
    "1. Run the tests."
  );
  assert.deepEqual(seen, [
    { query: "deploy", repoId: REPO },
    { slug: "deploy-checklist" },
  ]);

  const rejected = assertSingleMcpResponse(
    await call("mogplex_get_skill", { slug: "x", extra: true })
  ) as { result?: { isError?: boolean }; error?: unknown };
  assert.ok(
    rejected.error || rejected.result?.isError,
    "unknown arguments are refused"
  );
});

test("MogplexApiClient builds the skills URLs and leaves out unset filters", async () => {
  const { MogplexApiClient } = await import("../../lib/mogplex-api/client");
  const seen: string[] = [];
  const client = new MogplexApiClient({
    baseUrl: "https://app.example",
    authorization: "mog_test",
    fetch: async (input) => {
      seen.push(String(input));
      return Response.json({
        ok: true,
        data: { skills: [], total: 0, skill: null },
      });
    },
  });
  await client.listSkills({ query: "deploy", repoId: REPO, limit: 5 });
  await client.listSkills();
  await client.getSkill({ slug: "release notes/2" });
  assert.deepEqual(seen, [
    `https://app.example/api/v1/mogplex/skills?q=deploy&repoId=${REPO}&limit=5`,
    "https://app.example/api/v1/mogplex/skills",
    "https://app.example/api/v1/mogplex/skills/release%20notes%2F2",
  ]);
});
