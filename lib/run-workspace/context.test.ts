import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";
import { loadRunWorkspace } from "./context";

function fixture(
  options: {
    missing?: string;
    error?: string;
    guidance?: boolean;
    sandbox?: boolean;
    harness?: string;
    checkpoint?: Record<string, unknown>;
    status?: string;
  } = {}
) {
  const calls: URL[] = [];
  const client = createClient("https://database.example.test", "fixture", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (url) => {
        const parsed = new URL(String(url));
        calls.push(parsed);
        const table = parsed.pathname.split("/").at(-1)!;
        if (table === options.error)
          return Response.json(
            { message: "database failure" },
            { status: 500 }
          );
        if (table === options.missing) return Response.json(null);
        if (table === "external_agent_runs")
          return Response.json({
            id: "run",
            user_id: "owner",
            repo_id: "repo",
            ai_call_id: "call",
            harness: options.harness ?? "mogplex",
            status:
              options.status ??
              (options.checkpoint ? "awaiting_input" : "streaming"),
            prompt: "Fix mobile",
            working_branch: "fix/mobile",
            root_directory: null,
            sandbox_record_id: options.sandbox === false ? null : "sandbox",
            metadata: options.guidance
              ? {
                  slack_guidance_enabled: true,
                  slack_user_id: "U1",
                  slackRunControls: {
                    teamId: "T1",
                    channelId: "C1",
                    messageTs: "1.2",
                  },
                }
              : (options.checkpoint ?? {}),
          });
        if (table === "repos")
          return Response.json({
            id: "repo",
            user_id: "owner",
            full_name: "acme/app",
            created_at: "",
          });
        if (table === "sandboxes") return Response.json({ id: "sandbox" });
        return Response.json([
          {
            id: "00000000-0000-4000-8000-000000000001",
            run_id: "00000000-0000-4000-8000-000000000002",
            user_id: "00000000-0000-4000-8000-000000000003",
            ai_call_id: "00000000-0000-4000-8000-000000000004",
            status: "delivered",
            body: "Preserve desktop",
            attachments: null,
            created_at: "",
            delivered_step: 1,
          },
        ]);
      },
    },
  });
  return { client, calls };
}

it("loads owner-filtered context, sandbox and persisted guidance through the database client", async () => {
  const { client, calls } = fixture({ guidance: true });
  expect(await loadRunWorkspace("owner", "run", client)).toMatchObject({
    sandboxRecordId: "sandbox",
    canGuide: true,
    guidance: [{ body: "Preserve desktop", status: "delivered" }],
  });
  expect(
    calls
      .filter((url) => !url.pathname.endsWith("repos"))
      .every((url) => url.searchParams.get("user_id") === "eq.owner")
  ).toBe(true);
  expect(
    calls
      .find((url) => url.pathname.endsWith("sandboxes"))
      ?.searchParams.get("working_branch")
  ).toBe("eq.fix/mobile");
  expect(
    calls
      .find((url) => url.pathname.endsWith("repos"))
      ?.searchParams.get("select")
  ).not.toContain("sandbox_env_vars");
});

it("allows viewing runs whose sandbox has not been created or is no longer accessible", async () => {
  for (const options of [{ sandbox: false }, { missing: "sandboxes" }]) {
    const { client } = fixture(options);
    expect(await loadRunWorkspace("owner", "run", client)).toMatchObject({
      sandboxRecordId: null,
    });
  }
});

it("offers live guidance on native runs that did not start in Slack", async () => {
  const { client } = fixture();
  expect(await loadRunWorkspace("owner", "run", client)).toMatchObject({
    canGuide: true,
    guidance: [{ body: "Preserve desktop", status: "delivered" }],
  });
});

it("does not offer live guidance to CLI harness runs", async () => {
  const { client, calls } = fixture({ harness: "claude-code" });
  expect(await loadRunWorkspace("owner", "run", client)).toMatchObject({
    canGuide: false,
    guidance: [],
  });
  expect(calls.some((url) => url.pathname.endsWith("slack_run_guidance"))).toBe(
    false
  );
});

it("returns no context for missing owned runs or repositories", async () => {
  for (const missing of ["external_agent_runs", "repos"]) {
    const { client } = fixture({ missing });
    expect(await loadRunWorkspace("owner", "run", client)).toBeNull();
  }
});

it("fails closed when any required lookup fails", async () => {
  for (const error of [
    "external_agent_runs",
    "repos",
    "sandboxes",
    "slack_run_guidance",
  ]) {
    const { client } = fixture({ error, guidance: true });
    await expect(loadRunWorkspace("owner", "run", client)).rejects.toThrow();
  }
});

it("returns the saved plan checkpoint beside the owned run", async () => {
  const { client } = fixture({
    checkpoint: {
      checkpoint_kind: "plan",
      checkpoint_summary: "Add signing support.",
    },
  });
  expect(await loadRunWorkspace("owner", "run", client)).toMatchObject({
    status: "awaiting_input",
    checkpoint: { kind: "plan", summary: "Add signing support." },
  });
});

it.each([
  { checkpoint_kind: "review", checkpoint_summary: "Review the changes." },
  {},
  { checkpoint_kind: "review", checkpoint_summary: { invalid: true } },
])(
  "keeps review and legacy checkpoint metadata safe for the client: %j",
  async (checkpoint) => {
    const { client } = fixture({ checkpoint });
    expect(
      (await loadRunWorkspace("owner", "run", client))?.checkpoint
    ).toEqual({
      kind: "review",
      summary:
        typeof checkpoint.checkpoint_summary === "string"
          ? checkpoint.checkpoint_summary
          : "",
    });
  }
);

it.each(["streaming", "success"])(
  "does not offer a saved checkpoint after the run becomes %s",
  async (status) => {
    const { client } = fixture({
      status,
      checkpoint: {
        checkpoint_kind: "plan",
        checkpoint_summary: "Previously approved plan.",
      },
    });
    expect(
      (await loadRunWorkspace("owner", "run", client))?.checkpoint
    ).toBeNull();
  }
);
