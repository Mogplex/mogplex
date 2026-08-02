import assert from "node:assert/strict";
import test from "node:test";

async function loadVercelTargetsRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/vercel/targets/route");
}

test("POST /api/vercel/targets creates a project with the user's token and team", async () => {
  const { createVercelTargetsPostHandler } = await loadVercelTargetsRoute();
  let receivedUrl: string | null = null;
  let receivedAuth: string | null = null;
  let receivedBody: string | null = null;

  const handler = createVercelTargetsPostHandler({
    getUserCredentials: async () => ({
      userId: "user-123",
      githubToken: null,
      vercelToken: "user-vercel-token",
      vercelTeamId: "team_default",
    }),
    fetch: async (input, init) => {
      receivedUrl = String(input);
      receivedAuth = String(
        init?.headers && "Authorization" in init.headers
          ? init.headers.Authorization
          : (init?.headers as Record<string, string>)?.Authorization
      );
      receivedBody = String(init?.body || "");
      return Response.json(
        {
          id: "prj_created",
          name: "repo-preview",
          framework: "nextjs",
        },
        { status: 200 }
      );
    },
  });

  const response = await handler(
    new Request("http://localhost/api/vercel/targets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "repo-preview", teamId: "team_abc" }),
    })
  );

  assert.equal(response.status, 200);
  assert.equal(
    receivedUrl,
    "https://api.vercel.com/v11/projects?teamId=team_abc"
  );
  assert.equal(receivedAuth, "Bearer user-vercel-token");
  assert.equal(receivedBody, JSON.stringify({ name: "repo-preview" }));
  assert.deepEqual(await response.json(), {
    project: {
      id: "prj_created",
      name: "repo-preview",
      framework: "nextjs",
    },
    teamId: "team_abc",
  });
});

test("POST /api/vercel/targets fails when Vercel is not connected", async () => {
  const { createVercelTargetsPostHandler } = await loadVercelTargetsRoute();

  const handler = createVercelTargetsPostHandler({
    getUserCredentials: async () => null,
  });

  const response = await handler(
    new Request("http://localhost/api/vercel/targets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "repo-preview" }),
    })
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "VERCEL_NOT_CONNECTED" });
});

test("GET /api/vercel/targets returns validation metadata for the selected billing project", async () => {
  const { createVercelTargetsGetHandler } = await loadVercelTargetsRoute();

  const handler = createVercelTargetsGetHandler({
    getUserCredentials: async () => ({
      userId: "user-123",
      githubToken: null,
      vercelToken: "user-vercel-token",
      vercelTeamId: "team_default",
    }),
    fetch: async (input) => {
      const url = String(input);
      if (url.startsWith("https://api.vercel.com/v2/teams")) {
        return Response.json(
          {
            teams: [{ id: "team_abc", slug: "acme" }],
          },
          { status: 200 }
        );
      }

      if (
        url === "https://api.vercel.com/v10/projects?limit=100&teamId=team_abc"
      ) {
        return Response.json(
          {
            projects: [
              { id: "prj_1", name: "project-one", framework: "nextjs" },
            ],
          },
          { status: 200 }
        );
      }

      if (
        url === "https://api.vercel.com/v9/projects/prj_missing?teamId=team_abc"
      ) {
        return new Response("missing", { status: 404 });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    },
  });

  const response = await handler(
    new Request(
      "http://localhost/api/vercel/targets?teamId=team_abc&validationProjectId=prj_missing&validationTeamId=team_abc"
    )
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    teams: [
      { id: "personal", name: "Personal" },
      { id: "team_abc", name: "acme" },
    ],
    projects: [{ id: "prj_1", name: "project-one", framework: "nextjs" }],
    defaultTeamId: "personal",
    linkedProjectValidation: {
      state: "inaccessible",
      source: null,
      message:
        "The repo-linked Vercel project is missing or inaccessible. Select or create a different project to restore user-billed sandbox launch.",
      action: "select_project",
    },
    validation: {
      ok: false,
      code: "PROJECT_NOT_FOUND",
    },
    teamsLoadFailed: false,
  });
});

test("GET /api/vercel/targets returns linked project validation when Personal Vercel is not linked", async () => {
  const { createVercelTargetsGetHandler } = await loadVercelTargetsRoute();

  const handler = createVercelTargetsGetHandler({
    getUserCredentials: async () => null,
  });

  const response = await handler(
    new Request(
      "http://localhost/api/vercel/targets?validationBillingMode=user_vercel_project&validationSource=workspace&validationProjectId=prj_workspace"
    )
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "VERCEL_NOT_CONNECTED",
    linkedProjectValidation: {
      state: "auth_invalid",
      source: "workspace",
      message:
        "Link Personal Vercel to keep using your own Vercel project for sandbox billing.",
      action: "link_personal_vercel",
    },
    validation: null,
  });
});

test("shouldEscalateTeamsLoadFailure escalates auth + forbidden + not-configured", async () => {
  const { shouldEscalateTeamsLoadFailure } = await loadVercelTargetsRoute();
  assert.equal(
    shouldEscalateTeamsLoadFailure({
      code: "AUTH_INVALID",
      status: 401,
      message: "auth invalid",
    }),
    true
  );
  assert.equal(
    shouldEscalateTeamsLoadFailure({
      code: "TEAM_FORBIDDEN",
      status: 403,
      message: "forbidden",
    }),
    true
  );
  assert.equal(
    shouldEscalateTeamsLoadFailure({
      code: "NOT_CONFIGURED",
      status: 500,
      message: "missing token",
    }),
    true
  );
});

test("shouldEscalateTeamsLoadFailure soft-fails on rate-limit and unknown errors", async () => {
  // Transient codes shouldn't lock the picker — the projects call may still
  // succeed under personal scope.
  const { shouldEscalateTeamsLoadFailure } = await loadVercelTargetsRoute();
  assert.equal(
    shouldEscalateTeamsLoadFailure({
      code: "RATE_LIMITED",
      status: 429,
      message: "rate limited",
    }),
    false
  );
  assert.equal(
    shouldEscalateTeamsLoadFailure({
      code: "API_ERROR",
      status: 500,
      message: "transient",
    }),
    false
  );
});

test("GET /api/vercel/targets escalates a forbidden teams call to a reconnect-class response", async () => {
  // A 403 on the non-team-scoped /v2/teams call is mapped by the service to
  // AUTH_INVALID (a token that can't list teams is effectively broken). The
  // route should escalate that into VERCEL_AUTH_INVALID/401 instead of
  // silently dropping the user's teams from the picker.
  const { createVercelTargetsGetHandler } = await loadVercelTargetsRoute();
  const handler = createVercelTargetsGetHandler({
    getUserCredentials: async () => ({
      userId: "user-123",
      githubToken: null,
      vercelToken: "user-vercel-token",
      vercelTeamId: null,
    }),
    fetch: async (input) => {
      const url = String(input);
      if (url.includes("/v2/teams")) {
        return new Response("forbidden", { status: 403 });
      }
      // Should NOT be called: route returns early on the forbidden teams call.
      throw new Error(`unexpected fetch ${url}`);
    },
  });

  const response = await handler(
    new Request("https://example.com/api/vercel/targets?teamId=personal")
  );

  assert.equal(response.status, 401);
  const body = (await response.json()) as { error: string };
  assert.equal(body.error, "VERCEL_AUTH_INVALID");
});

test("GET /api/vercel/targets soft-fails teams RATE_LIMITED and still returns projects", async () => {
  const { createVercelTargetsGetHandler } = await loadVercelTargetsRoute();
  const handler = createVercelTargetsGetHandler({
    getUserCredentials: async () => ({
      userId: "user-123",
      githubToken: null,
      vercelToken: "user-vercel-token",
      vercelTeamId: null,
    }),
    fetch: async (input) => {
      const url = String(input);
      if (url.includes("/v2/teams")) {
        return new Response("rate limited", { status: 429 });
      }
      if (url.includes("/v10/projects")) {
        return new Response(
          JSON.stringify({
            projects: [{ id: "prj_1", name: "site", framework: "nextjs" }],
          }),
          { status: 200 }
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    },
  });

  const response = await handler(
    new Request("https://example.com/api/vercel/targets?teamId=personal")
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    teams: { id: string }[];
    projects: { id: string }[];
    teamsLoadFailed: boolean;
  };
  assert.equal(body.teamsLoadFailed, true);
  assert.equal(Object.hasOwn(body, "teamsLoadFailureMessage"), false);
  assert.deepEqual(
    body.teams.map((team) => team.id),
    ["personal"]
  );
  assert.deepEqual(
    body.projects.map((project) => project.id),
    ["prj_1"]
  );
});
