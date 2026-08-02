import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

async function loadTerminalSessionRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/sandbox/[id]/terminal/session/route");
}

test("POST /api/sandbox/[id]/terminal/session requests the Vercel ownership fields needed to hydrate the sandbox client", async () => {
  const { createTerminalSessionPostHandler } = await loadTerminalSessionRoute();

  let requestedSelect = "";
  let killCommand: { cmd: string; args: string[] } | null = null;

  const handler = createTerminalSessionPostHandler({
    loadOwnedSandboxRouteContext: async (_request, _sandboxId, options) => {
      requestedSelect = options.select;
      return {
        ok: true,
        record: {
          sandbox_id: "sandbox-runtime-1",
          billing_team_id: "team-acme",
          billing_project_id: "project-acme",
          vercel_team_id: "team-acme",
          vercel_project_id: "project-acme",
        },
        repo: null,
        context: {} as never,
        sandbox: {
          runCommand: async (input: { cmd: string; args: string[] }) => {
            killCommand = input;
            return {
              stdout: async () => "",
            };
          },
        },
      } as never;
    },
  });

  const terminalSessionKey = "pane:one/shared";
  const response = await handler(
    new Request("http://localhost/api/sandbox/sandbox-1/terminal/session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "kill",
        terminalSessionKey,
      }),
    }),
    { params: Promise.resolve({ id: "sandbox-1" }) }
  );

  assert.equal(response.status, 200);
  assert.match(requestedSelect, /\bbilling_team_id\b/);
  assert.match(requestedSelect, /\bbilling_project_id\b/);
  assert.match(requestedSelect, /\bvercel_team_id\b/);
  assert.match(requestedSelect, /\bvercel_project_id\b/);

  const expectedTmuxName = `mogplex-${createHash("sha256")
    .update(terminalSessionKey)
    .digest("hex")
    .slice(0, 24)}`;
  assert.deepEqual(killCommand, {
    cmd: "sh",
    args: [
      "-lc",
      `tmux kill-session -t '${expectedTmuxName}' 2>/dev/null || true`,
    ],
  });

  assert.deepEqual(await response.json(), {
    ok: true,
    terminalSessionKey,
  });
});
