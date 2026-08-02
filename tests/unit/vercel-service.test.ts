import assert from "node:assert/strict";
import test from "node:test";

async function loadVercelService() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/vercel/service");
}

test("listVercelProjects maps team-scoped 403 responses to TEAM_FORBIDDEN", async () => {
  const { listVercelProjects } = await loadVercelService();

  const result = await listVercelProjects(
    {
      authMode: "personal",
      vercelToken: "user-token",
      teamId: "team-acme",
    },
    async () => new Response("forbidden", { status: 403 })
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "TEAM_FORBIDDEN");
});

test("validateVercelProjectAccess maps missing projects to PROJECT_NOT_FOUND", async () => {
  const { validateVercelProjectAccess } = await loadVercelService();

  const result = await validateVercelProjectAccess(
    {
      authMode: "personal",
      vercelToken: "user-token",
      projectId: "prj_missing",
      teamId: "team-acme",
    },
    async () => new Response("missing", { status: 404 })
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "PROJECT_NOT_FOUND");
});

test("listVercelProjectEnvVars reports NOT_CONFIGURED when platform credentials are missing", async () => {
  const { listVercelProjectEnvVars } = await loadVercelService();

  const result = await listVercelProjectEnvVars({
    authMode: "platform",
    vercelToken: null,
    projectId: "prj_platform",
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "NOT_CONFIGURED");
});

test("listVercelProjectEnvVars follows pagination until all pages are read", async () => {
  const { listVercelProjectEnvVars } = await loadVercelService();
  const requestedUrls: string[] = [];

  const pages: Record<string, unknown> = {
    first: {
      envs: [{ id: "env_1", key: "A" }],
      pagination: { count: 1, next: 1_700_000_000_000, prev: null },
    },
    second: {
      envs: [{ id: "env_2", key: "B" }],
      pagination: { count: 1, next: null, prev: 1_700_000_000_000 },
    },
  };

  const result = await listVercelProjectEnvVars(
    {
      authMode: "personal",
      vercelToken: "user-token",
      projectId: "prj_1",
    },
    async (url) => {
      const requested = String(url);
      requestedUrls.push(requested);
      const page = requested.includes("until=") ? pages.second : pages.first;
      return Response.json(page);
    }
  );

  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(
    result.data.map((entry) => entry.id),
    ["env_1", "env_2"]
  );
  assert.equal(requestedUrls.length, 2);
  assert.ok(requestedUrls[1]?.includes("until=1700000000000"));
});

test("listVercelProjectEnvVars drops boundary entries repeated across pages", async () => {
  const { listVercelProjectEnvVars } = await loadVercelService();

  const result = await listVercelProjectEnvVars(
    {
      authMode: "personal",
      vercelToken: "user-token",
      projectId: "prj_1",
    },
    async (url) =>
      Response.json(
        String(url).includes("until=")
          ? {
              envs: [
                { id: "env_2", key: "B" },
                { id: "env_3", key: "C" },
              ],
              pagination: { count: 2, next: null, prev: 1 },
            }
          : {
              envs: [
                { id: "env_1", key: "A" },
                { id: "env_2", key: "B" },
              ],
              pagination: { count: 2, next: 1_700_000_000_000, prev: null },
            }
      )
  );

  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(
    result.data.map((entry) => entry.id),
    ["env_1", "env_2", "env_3"]
  );
});

test("listVercelProjectEnvVars fails loudly instead of returning a truncated list", async () => {
  const { listVercelProjectEnvVars } = await loadVercelService();
  let requests = 0;

  const result = await listVercelProjectEnvVars(
    {
      authMode: "personal",
      vercelToken: "user-token",
      projectId: "prj_1",
    },
    async () => {
      requests += 1;
      return Response.json({
        envs: [{ id: `env_${requests}`, key: `K${requests}` }],
        pagination: {
          count: 1,
          next: 1_700_000_000_000 + requests,
          prev: null,
        },
      });
    }
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "API_ERROR");
  assert.equal(result.error.status, 502);
  assert.equal(requests, 20);
});

test("listVercelDeployments maps deployment summaries from the Vercel API", async () => {
  const { listVercelDeployments } = await loadVercelService();

  const result = await listVercelDeployments(
    {
      authMode: "platform",
      vercelToken: "platform-token",
      projectId: "prj_platform",
    },
    async () =>
      Response.json(
        {
          deployments: [
            {
              id: "dpl_123",
              projectId: "prj_platform",
              name: "platform-app",
              url: "platform-app.vercel.app",
              readyState: "ERROR",
              errorMessage: "Build failed",
              createdAt: 123,
            },
          ],
        },
        { status: 200 }
      )
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.data[0], {
    id: "dpl_123",
    projectId: "prj_platform",
    name: "platform-app",
    url: "platform-app.vercel.app",
    readyState: "ERROR",
    readySubstate: null,
    readyStateReason: null,
    errorCode: null,
    errorMessage: "Build failed",
    createdAt: 123,
    target: null,
    inspectorUrl: null,
  });
});

test("listVercelDeploymentBuildLogs parses build log events", async () => {
  const { listVercelDeploymentBuildLogs } = await loadVercelService();

  const result = await listVercelDeploymentBuildLogs(
    {
      authMode: "platform",
      vercelToken: "platform-token",
      deploymentId: "dpl_123",
    },
    async () =>
      Response.json(
        [
          {
            type: "build",
            created: 123,
            payload: {
              text: "Build failed: missing env var",
              statusCode: 500,
              info: {
                readyState: "ERROR",
              },
            },
          },
        ],
        { status: 200 }
      )
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.data[0], {
    type: "build",
    created: 123,
    text: "Build failed: missing env var",
    statusCode: 500,
    readyState: "ERROR",
  });
});

test("getVercelDeployment falls back to the deployment id when fields are omitted", async () => {
  const { getVercelDeployment } = await loadVercelService();

  const result = await getVercelDeployment(
    {
      authMode: "platform",
      vercelToken: "platform-token",
      deploymentId: "dpl_missing_fields",
    },
    async () => Response.json({}, { status: 200 })
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.data, {
    id: "dpl_missing_fields",
    projectId: null,
    name: "dpl_missing_fields",
    url: null,
    readyState: null,
    readySubstate: null,
    readyStateReason: null,
    errorCode: null,
    errorMessage: null,
    createdAt: null,
    target: null,
    inspectorUrl: null,
  });
});

test("upsertVercelProjectEnvVar builds the create payload with default targets", async () => {
  const { upsertVercelProjectEnvVar } = await loadVercelService();

  let requestUrl = "";
  let requestInit: RequestInit | undefined;

  const result = await upsertVercelProjectEnvVar(
    {
      authMode: "personal",
      vercelToken: "user-token",
      teamId: "team-acme",
      projectId: "prj_123",
      key: "  API_KEY  ",
      value: "secret",
    },
    async (url, init) => {
      requestUrl = String(url);
      requestInit = init;
      return Response.json(
        {
          id: "env_new",
          key: "API_KEY",
          value: "secret",
          target: ["production", "preview", "development"],
          type: "encrypted",
        },
        { status: 200 }
      );
    }
  );

  assert.equal(requestUrl.includes("teamId=team-acme"), true);
  assert.equal(requestInit?.method, "POST");
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    key: "API_KEY",
    value: "secret",
    target: ["production", "preview", "development"],
    type: "encrypted",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.id, "env_new");
});

test("upsertVercelProjectEnvVar returns the updated env summary for patch requests", async () => {
  const { upsertVercelProjectEnvVar } = await loadVercelService();

  let requestInit: RequestInit | undefined;

  const result = await upsertVercelProjectEnvVar(
    {
      authMode: "personal",
      vercelToken: "user-token",
      projectId: "prj_123",
      envId: "env_existing",
      key: "API_KEY",
      value: "rotated-secret",
      target: ["preview"],
      type: "plain",
    },
    async (_url, init) => {
      requestInit = init;
      return new Response(null, { status: 200 });
    }
  );

  assert.equal(requestInit?.method, "PATCH");
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    value: "rotated-secret",
    target: ["preview"],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.data, {
    id: "env_existing",
    key: "API_KEY",
    value: "rotated-secret",
    target: ["preview"],
    type: "plain",
  });
});
