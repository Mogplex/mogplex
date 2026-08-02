import assert from "node:assert/strict";
import test from "node:test";

async function loadDiagnostics() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/vercel/load-sandbox-diagnostics");
}

test("loadSandboxVercelDiagnostics marks missing deployments explicitly", async () => {
  const { loadSandboxVercelDiagnostics } = await loadDiagnostics();

  const responses = new Map<string, Response>([
    [
      "https://api.vercel.com/v9/projects/prj_missing?teamId=team-acme",
      Response.json(
        { id: "prj_missing", name: "Missing App" },
        {
          status: 200,
        }
      ),
    ],
    [
      "https://api.vercel.com/v6/deployments?teamId=team-acme&projectId=prj_missing&limit=8",
      Response.json({ deployments: [] }, { status: 200 }),
    ],
  ]);

  const result = await loadSandboxVercelDiagnostics(
    {
      authMode: "platform",
      vercelToken: "platform-token",
      teamId: "team-acme",
      projectId: "prj_missing",
    },
    async (input) =>
      responses.get(String(input)) ?? new Response("not found", { status: 404 })
  );

  assert.equal(result?.state, "deployment_missing");
  assert.equal(
    result?.buildSummary,
    "No deployments were found for the linked Vercel project."
  );
});

test("loadSandboxVercelDiagnostics surfaces build failures from deployment logs", async () => {
  const { loadSandboxVercelDiagnostics } = await loadDiagnostics();

  const responses = new Map<string, Response>([
    [
      "https://api.vercel.com/v9/projects/prj_build?teamId=team-acme",
      Response.json(
        { id: "prj_build", name: "Build App" },
        {
          status: 200,
        }
      ),
    ],
    [
      "https://api.vercel.com/v6/deployments?teamId=team-acme&projectId=prj_build&limit=8",
      Response.json(
        {
          deployments: [
            {
              id: "dpl_123",
              projectId: "prj_build",
              name: "Build App",
              url: "build-app.vercel.app",
              readyState: "ERROR",
              createdAt: 123,
            },
          ],
        },
        { status: 200 }
      ),
    ],
    [
      "https://api.vercel.com/v13/deployments/dpl_123?teamId=team-acme",
      Response.json(
        {
          id: "dpl_123",
          projectId: "prj_build",
          name: "Build App",
          url: "build-app.vercel.app",
          readyState: "ERROR",
          errorMessage: null,
          readyStateReason: null,
          createdAt: 123,
        },
        { status: 200 }
      ),
    ],
    [
      "https://api.vercel.com/v3/deployments/dpl_123/events?teamId=team-acme&builds=1&direction=backward&limit=40",
      Response.json(
        [
          {
            type: "build",
            created: 124,
            payload: {
              text: "Error: Missing NEXT_PUBLIC_API_URL",
              statusCode: 500,
              info: { readyState: "ERROR" },
            },
          },
        ],
        { status: 200 }
      ),
    ],
  ]);

  const result = await loadSandboxVercelDiagnostics(
    {
      authMode: "platform",
      vercelToken: "platform-token",
      teamId: "team-acme",
      projectId: "prj_build",
    },
    async (input) =>
      responses.get(String(input)) ?? new Response("not found", { status: 404 })
  );

  assert.equal(result?.state, "build_failed");
  assert.equal(result?.deploymentId, "dpl_123");
  assert.equal(result?.deploymentUrl, "https://build-app.vercel.app");
  assert.equal(result?.buildSummary, "Error: Missing NEXT_PUBLIC_API_URL");
});

test("loadSandboxVercelDiagnostics falls back to the newest build log line when no explicit error token exists", async () => {
  const { loadSandboxVercelDiagnostics } = await loadDiagnostics();

  const responses = new Map<string, Response>([
    [
      "https://api.vercel.com/v9/projects/prj_logs?teamId=team-acme",
      Response.json(
        { id: "prj_logs", name: "Logs App" },
        {
          status: 200,
        }
      ),
    ],
    [
      "https://api.vercel.com/v6/deployments?teamId=team-acme&projectId=prj_logs&limit=8",
      Response.json(
        {
          deployments: [
            {
              id: "dpl_logs",
              projectId: "prj_logs",
              name: "Logs App",
              url: "logs-app.vercel.app",
              readyState: "ERROR",
              createdAt: 123,
            },
          ],
        },
        { status: 200 }
      ),
    ],
    [
      "https://api.vercel.com/v13/deployments/dpl_logs?teamId=team-acme",
      Response.json(
        {
          id: "dpl_logs",
          projectId: "prj_logs",
          name: "Logs App",
          url: "logs-app.vercel.app",
          readyState: "ERROR",
          errorMessage: null,
          readyStateReason: null,
          createdAt: 123,
        },
        { status: 200 }
      ),
    ],
    [
      "https://api.vercel.com/v3/deployments/dpl_logs/events?teamId=team-acme&builds=1&direction=backward&limit=40",
      Response.json(
        [
          {
            type: "build",
            created: 130,
            payload: {
              text: "Newest summary line",
              statusCode: 500,
              info: { readyState: "ERROR" },
            },
          },
          {
            type: "build",
            created: 120,
            payload: {
              text: "Oldest summary line",
              statusCode: 500,
              info: { readyState: "ERROR" },
            },
          },
        ],
        { status: 200 }
      ),
    ],
  ]);

  const result = await loadSandboxVercelDiagnostics(
    {
      authMode: "platform",
      vercelToken: "platform-token",
      teamId: "team-acme",
      projectId: "prj_logs",
    },
    async (input) =>
      responses.get(String(input)) ?? new Response("not found", { status: 404 })
  );

  assert.equal(result?.state, "build_failed");
  assert.equal(result?.buildSummary, "Newest summary line");
});

test("loadSandboxVercelDiagnostics reports in-progress deployments as building", async () => {
  const { loadSandboxVercelDiagnostics } = await loadDiagnostics();

  const responses = new Map<string, Response>([
    [
      "https://api.vercel.com/v9/projects/prj_building",
      Response.json(
        { id: "prj_building", name: "Building App" },
        { status: 200 }
      ),
    ],
    [
      "https://api.vercel.com/v6/deployments?projectId=prj_building&limit=8",
      Response.json(
        {
          deployments: [
            {
              id: "dpl_building",
              projectId: "prj_building",
              name: "Building App",
              url: "building-app.vercel.app",
              readyState: "BUILDING",
              readyStateReason: "Queued on build machine",
              createdAt: 123,
            },
          ],
        },
        { status: 200 }
      ),
    ],
    [
      "https://api.vercel.com/v13/deployments/dpl_building",
      Response.json(
        {
          id: "dpl_building",
          projectId: "prj_building",
          name: "Building App",
          url: "building-app.vercel.app",
          readyState: "BUILDING",
          readyStateReason: "Queued on build machine",
          createdAt: 123,
        },
        { status: 200 }
      ),
    ],
  ]);

  const result = await loadSandboxVercelDiagnostics(
    {
      authMode: "platform",
      vercelToken: "platform-token",
      projectId: "prj_building",
    },
    async (input) =>
      responses.get(String(input)) ?? new Response("not found", { status: 404 })
  );

  assert.equal(result?.state, "building");
  assert.equal(result?.buildSummary, "Queued on build machine");
});
