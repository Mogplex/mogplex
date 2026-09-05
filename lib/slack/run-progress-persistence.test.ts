import { afterEach, expect, it, vi } from "vitest";
import { createSlackRunProgressReporter } from "./run-progress-notify";
import {
  publishRunProgress,
  readRunProgressSnapshot,
} from "./run-progress-store";
import { createRunProgressState } from "./run-progress-state";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const run = {
  id: "00000000-0000-4000-8000-000000000001",
  user_id: "00000000-0000-4000-8000-000000000002",
  ai_call_id: "00000000-0000-4000-8000-000000000003",
  metadata: {
    slackRunControls: { teamId: "T1", channelId: "C1", messageTs: "1.2" },
  },
};
function environment() {
  vi.stubEnv("MOGPLEX_DATA_BACKEND", "supabase");
  vi.stubEnv("SUPABASE_URL", "https://database.example.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fixture-key");
  vi.stubEnv("TRIGGER_SECRET_KEY", "tr_dev_fixture");
  vi.stubEnv("TRIGGER_API_URL", "https://trigger.example.test");
}

it("the production reporter persists its scoped snapshot and queues delivery without calling Slack inline", async () => {
  environment();
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  vi.stubGlobal(
    "fetch",
    async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      calls.push({ url: target, body: JSON.parse(String(init?.body)) });
      if (target.includes("/rpc/publish_slack_run_progress"))
        return Response.json(1);
      if (target.includes("/tasks/deliver-slack-run-update/trigger"))
        return Response.json({ id: "run_delivery1" });
      throw new Error("Unexpected network request");
    }
  );
  const reporter = createSlackRunProgressReporter(run, { now: () => 1000 });
  await reporter.report({
    kind: "phase",
    phase: "Investigating",
    summary: "Found the mobile overlap.",
  });
  await reporter.flush();
  expect(calls).toHaveLength(2);
  expect(calls[0].body).toMatchObject({
    p_run_id: run.id,
    p_user_id: run.user_id,
    p_ai_call_id: run.ai_call_id,
    p_progress: { summary: "Found the mobile overlap." },
  });
  expect(JSON.parse(String(calls[1].body.payload))).toMatchObject({
    json: { runId: run.id, userId: run.user_id },
  });
  expect(calls[1].body).toMatchObject({
    options: { concurrencyKey: `slack-run-delivery:${run.id}` },
  });
  expect(calls.some((call) => call.url.includes("slack.com"))).toBe(false);
});

it("rejects malformed provider revisions instead of silently acknowledging a failed save", async () => {
  environment();
  for (const data of ["garbage", -1, 1.5]) {
    vi.stubGlobal("fetch", async () => Response.json(data));
    await expect(
      publishRunProgress({
        runId: run.id,
        userId: run.user_id,
        aiCallId: run.ai_call_id,
        state: createRunProgressState(1000),
      })
    ).rejects.toThrow();
  }
  expect(readRunProgressSnapshot({ lastActivityAt: Infinity })).toBeNull();
});
