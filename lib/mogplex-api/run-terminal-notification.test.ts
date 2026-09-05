import { afterEach, expect, it, vi } from "vitest";
import { notifyTerminalSlackRunOnce } from "./run-terminal-notification";
import { stripSlackRunControlsForTerminalRun } from "@/lib/slack/run-controls-notify";
import { buildRunRow } from "../../tests/unit/helpers/mogplex-api-runs-fixtures";

afterEach(() => vi.unstubAllEnvs());
function fixture() {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.test");
  let run = buildRunRow({
    status: "failed",
    metadata: {
      slackRunControls: { teamId: "T1", channelId: "C1", messageTs: "1.1" },
    },
  });
  let token: string | null = "fixture";
  let failSend = false;
  let failMark = false;
  const updates: string[] = [];
  const marks: string[] = [];
  let tokenReads = 0;
  const deps = {
    send: async (row: typeof run, status: typeof run.status) =>
      stripSlackRunControlsForTerminalRun(row, status, {
        getSlackBotToken: async () => {
          tokenReads++;
          return token;
        },
        updateSlackMessage: async (_token, input) => {
          if (failSend) throw new Error("Slack unavailable");
          updates.push(input.text);
        },
      }),
    markDelivered: async (
      _row: typeof run,
      _status: typeof run.status,
      key: string
    ) => {
      if (failMark) throw new Error("Database unavailable");
      marks.push(key);
      run = { ...run, slack_terminal_notification_key: key };
    },
  };
  return {
    deliver: () => notifyTerminalSlackRunOnce(run, run.status, deps),
    updates,
    marks,
    tokenReads: () => tokenReads,
    patch: (value: Partial<typeof run>) => {
      run = { ...run, ...value };
    },
    token: (value: string | null) => {
      token = value;
    },
    failSend: (value: boolean) => {
      failSend = value;
    },
    failMark: (value: boolean) => {
      failMark = value;
    },
  };
}

it("repeated terminal reads perform no Slack lookup or edit after delivery", async () => {
  const f = fixture();
  await f.deliver();
  await f.deliver();
  await f.deliver();
  expect(f.updates).toHaveLength(1);
  expect(f.marks).toHaveLength(1);
  expect(f.tokenReads()).toBe(1);
});
it("failed delivery stays pending and retries without marking success", async () => {
  const f = fixture();
  f.failSend(true);
  await expect(f.deliver()).rejects.toThrow("Slack unavailable");
  expect(f.marks).toEqual([]);
  f.failSend(false);
  await f.deliver();
  await f.deliver();
  expect(f.updates).toHaveLength(1);
  expect(f.marks).toHaveLength(1);
});
it("retries when delivery succeeded but recording it failed", async () => {
  const f = fixture();
  f.failMark(true);
  await expect(f.deliver()).rejects.toThrow("Database unavailable");
  f.failMark(false);
  await f.deliver();
  await f.deliver();
  expect(f.updates).toHaveLength(2);
  expect(f.marks).toHaveLength(1);
});
it("does not mark missing credentials as successful delivery", async () => {
  const f = fixture();
  f.token(null);
  await f.deliver();
  expect(f.marks).toEqual([]);
  f.token("fixture");
  await f.deliver();
  await f.deliver();
  expect(f.updates).toHaveLength(1);
});
it("a new call or destination needs its own terminal delivery", async () => {
  const f = fixture();
  await f.deliver();
  f.patch({ ai_call_id: "new-call" });
  await f.deliver();
  f.patch({
    metadata: {
      slackRunControls: { teamId: "T1", channelId: "C1", messageTs: "2.2" },
    },
  });
  await f.deliver();
  await f.deliver();
  expect(f.updates).toHaveLength(3);
  expect(new Set(f.marks).size).toBe(3);
});
it("non-Slack and active runs have nothing terminal to deliver", async () => {
  const f = fixture();
  f.patch({ status: "streaming" });
  await f.deliver();
  f.patch({ status: "failed", metadata: {} });
  await f.deliver();
  expect(f.updates).toEqual([]);
  expect(f.marks).toEqual([]);
  expect(f.tokenReads()).toBe(0);
});
