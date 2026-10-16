import { expect, it } from "vitest";
import type { SlackInstallationRow } from "./installations";
import { SLACK_VIEW_CHANGES_ACTION_ID } from "./command-actions";
import { handleViewRunChangesAction } from "./run-changes-interactions";
import type { SlackBlockActionsPayload } from "./interactivity";

process.env.NEXT_PUBLIC_APP_URL ||= "https://mogplex.com";

const RUN_ID = "00000000-0000-4000-8000-000000000002";
const OWNER = "00000000-0000-4000-8000-000000000003";

const payload: SlackBlockActionsPayload = {
  type: "block_actions",
  team: { id: "T1" },
  user: { id: "U1" },
  trigger_id: "trigger-1",
  actions: [{ action_id: SLACK_VIEW_CHANGES_ACTION_ID, value: RUN_ID }],
};

const installation = {
  id: "inst-1",
  authed_user_slack_id: "U-installer",
  installed_by_user_id: "installer",
} as SlackInstallationRow;

function harness(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const views: Array<{ blocks: unknown[] }> = [];
  const deps = {
    getBotToken: async () => {
      calls.push("token");
      return "xoxb";
    },
    openView: async (
      _token: string,
      input: { view: { blocks: unknown[] } }
    ) => {
      calls.push("open");
      views.push(input.view);
      return { view: { id: "V1" } };
    },
    updateView: async (
      _token: string,
      input: { view: { blocks: unknown[] } }
    ) => {
      calls.push("update");
      views.push(input.view);
      return {};
    },
    getInstallation: async () => {
      calls.push("installation");
      return installation;
    },
    getUserMapping: async () => ({
      mogplex_user_id: OWNER,
      link_status: "explicit",
    }),
    loadRun: async (userId: string) =>
      userId === OWNER ? { id: RUN_ID, user_id: OWNER } : null,
    loadChanges: async () => ({
      ok: true as const,
      changes: {
        files: [],
        patchTruncated: false,
        source: "workspace" as const,
        baseBranch: "main",
        branch: "agent/fix",
      },
    }),
    ...overrides,
  };
  return { calls, views, deps };
}

it("should open the modal before any account lookup so the trigger id does not expire", async () => {
  const { calls, views, deps } = harness();

  const outcome = await handleViewRunChangesAction(
    payload,
    deps as unknown as Parameters<typeof handleViewRunChangesAction>[1]
  );

  expect(outcome).toBe("shown");
  expect(calls.slice(0, 3)).toEqual(["token", "open", "installation"]);
  expect(JSON.stringify(views[0])).toContain("Reading the run’s changes");
  expect(JSON.stringify(views.at(-1))).toContain("No changes yet.");
});

it("should not show another user's run changes", async () => {
  const { views, deps } = harness({
    getUserMapping: async () => ({
      mogplex_user_id: "someone-else",
      link_status: "explicit",
    }),
    loadChanges: async () => {
      throw new Error("must not load changes for a non-owner");
    },
  });

  const outcome = await handleViewRunChangesAction(
    payload,
    deps as unknown as Parameters<typeof handleViewRunChangesAction>[1]
  );

  expect(outcome).toBe("not_owner");
  expect(JSON.stringify(views.at(-1))).toContain(
    "Only the person who started this run"
  );
});

it("should replace the loading view with an error when reading changes fails", async () => {
  const { views, deps } = harness({
    loadChanges: async () => {
      throw new Error("GitHub compare HTTP 502");
    },
  });

  const outcome = await handleViewRunChangesAction(
    payload,
    deps as unknown as Parameters<typeof handleViewRunChangesAction>[1]
  );

  expect(outcome).toBe("failed");
  expect(JSON.stringify(views.at(-1))).toContain("could not read");
});

it("should ignore a click without a valid run id or trigger", async () => {
  const { calls, deps } = harness();

  const outcome = await handleViewRunChangesAction(
    { ...payload, trigger_id: undefined },
    deps as unknown as Parameters<typeof handleViewRunChangesAction>[1]
  );

  expect(outcome).toBe("invalid");
  expect(calls).toEqual([]);
});
