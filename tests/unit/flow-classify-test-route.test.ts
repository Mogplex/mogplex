import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";

const TEAM_ID = "11111111-2222-4333-8444-555555555555";

async function loadRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/flows/classify-test/route");
}

const validBody = {
  question: " Is this a bug report? ",
  output: { kind: "boolean" },
  state: "Login crashes on submit",
};

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/flows/classify-test", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const result = {
  kind: "boolean" as const,
  answer: true,
  confidence: 0.94,
  probabilities: { true: 0.94, false: 0.06 },
  uncertain: false,
};

test("POST /api/flows/classify-test answers a question about sample state", async () => {
  const { createClassifyTestPostHandler } = await loadRoute();
  const requests: unknown[] = [];
  const handler = createClassifyTestPostHandler({
    requireUserId: async () => "user-1",
    classify: async (request) => {
      requests.push(request);
      return { ok: true, result };
    },
  });

  const response = await handler(post({ ...validBody, minConfidence: 0.7 }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { result });
  assert.deepEqual(requests, [
    {
      question: "Is this a bug report?",
      output: { kind: "boolean" },
      state: "Login crashes on submit",
      minConfidence: 0.7,
      scope: { surface: "automation_test", userId: "user-1", teamId: null },
      metadata: { test: true },
    },
  ]);
});

test("POST /api/flows/classify-test records a team test against the team", async () => {
  const { createClassifyTestPostHandler } = await loadRoute();
  let teamId: unknown = "unset";
  const handler = createClassifyTestPostHandler({
    requireUserId: async () => "user-1",
    resolveActiveTeamCapabilities: async () => ({
      ok: true,
      teamId: TEAM_ID,
      capabilities: new Set(["*"]),
    }),
    classify: async (request) => {
      teamId = request.scope.teamId;
      return { ok: true, result };
    },
  });

  const response = await handler(
    post(validBody, { "x-mogplex-team-id": TEAM_ID })
  );

  assert.equal(response.status, 200);
  assert.equal(teamId, TEAM_ID);
});

test("POST /api/flows/classify-test rejects team viewers without classifying", async () => {
  const { createClassifyTestPostHandler } = await loadRoute();
  let classified = false;
  const handler = createClassifyTestPostHandler({
    requireUserId: async () => "user-1",
    resolveActiveTeamCapabilities: async () => ({
      ok: true,
      teamId: TEAM_ID,
      capabilities: new Set(["models.*"]),
    }),
    classify: async () => {
      classified = true;
      return { ok: true, result };
    },
  });

  const response = await handler(
    post(validBody, { "x-mogplex-team-id": TEAM_ID })
  );

  assert.equal(response.status, 403);
  assert.equal(classified, false);
});

test("POST /api/flows/classify-test requires a signed-in user", async () => {
  const { createClassifyTestPostHandler } = await loadRoute();
  const handler = createClassifyTestPostHandler({
    requireUserId: async () =>
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    classify: async () => {
      throw new Error("should not classify");
    },
  });

  assert.equal((await handler(post(validBody))).status, 401);
});

test("POST /api/flows/classify-test rejects malformed requests with the reason", async () => {
  const { createClassifyTestPostHandler } = await loadRoute();
  const handler = createClassifyTestPostHandler({
    requireUserId: async () => "user-1",
    classify: async () => {
      throw new Error("should not classify");
    },
  });

  const cases: Array<[unknown, RegExp]> = [
    ["not json", /must be a JSON object/],
    [[], /must be a JSON object/],
    [{ ...validBody, question: "  " }, /^question: /],
    [{ ...validBody, state: "" }, /^state: /],
    [{ ...validBody, minConfidence: 1 }, /^minConfidence: /],
    [{ ...validBody, output: { kind: "scale", levels: ["only"] } }, /^output/],
    [
      {
        ...validBody,
        output: {
          kind: "choice",
          options: [
            { id: "a", label: "Same" },
            { id: "b", label: "same" },
          ],
        },
      },
      /two options with the same label/,
    ],
  ];
  for (const [body, expected] of cases) {
    const response = await handler(post(body));
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.match((await response.json()).error, expected);
  }
});

test("POST /api/flows/classify-test reports an unavailable classifier as 503", async () => {
  const { createClassifyTestPostHandler } = await loadRoute();
  const handler = createClassifyTestPostHandler({
    requireUserId: async () => "user-1",
    classify: async () => ({ ok: false, message: "Classification timed out." }),
  });

  const response = await handler(post(validBody));

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "Classification timed out.",
  });
});
