import assert from "node:assert/strict";
import test, { before } from "node:test";

import type {
  SlackBlockActionsPayload,
  SlackInteractivityDeps,
} from "../../lib/slack/interactivity";
// Imported for value (not just type) so the error we throw from a `cancelRun`
// stub is `instanceof`-identical to the one `cancelRunAndRespond` checks for.
// Safe to load eagerly: `run-control` only touches Supabase lazily, inside calls.
import { MogplexApiRunControlError } from "../../lib/mogplex-api/run-control";

// `lib/slack/interactivity` pulls in the Supabase admin client at import time,
// which validates these env vars on construction — set them before importing.
type InteractivityModule = typeof import("../../lib/slack/interactivity");
let mod: InteractivityModule;

before(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  mod = await import("../../lib/slack/interactivity");
});

const INSTALLATION = { id: "install-1" } as Awaited<
  ReturnType<SlackInteractivityDeps["getInstallation"]>
>;

type CancelResult = Awaited<ReturnType<SlackInteractivityDeps["cancelRun"]>>;
const okCancel = (status: string, alreadyTerminal = false): CancelResult =>
  ({ run: {}, status, alreadyTerminal }) as unknown as CancelResult;

function makePayload(
  overrides: Partial<SlackBlockActionsPayload> = {}
): SlackBlockActionsPayload {
  return {
    type: "block_actions",
    team: { id: "T123" },
    user: { id: "U456" },
    response_url: "https://hooks.slack.test/response",
    actions: [
      {
        action_id: mod.SLACK_CANCEL_RUN_ACTION_ID,
        value: "run_abc",
        type: "button",
      },
    ],
    message: {
      text: ":rocket: Started run `run_abc`",
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: ":rocket: Started run `run_abc`" },
        },
        {
          type: "actions",
          block_id: mod.SLACK_RUN_CONTROLS_BLOCK_ID,
          elements: [],
        },
      ],
    },
    ...overrides,
  };
}

function makeDeps(overrides: Partial<SlackInteractivityDeps> = {}) {
  const posted: Array<{ url: string; body: Record<string, unknown> }> = [];
  const deps: Partial<SlackInteractivityDeps> = {
    getInstallation: async () => INSTALLATION,
    getUserMapping: async () =>
      ({ mogplex_user_id: "mog-user-1", link_status: "explicit" }) as Awaited<
        ReturnType<SlackInteractivityDeps["getUserMapping"]>
      >,
    cancelRun: async () => okCancel("cancelled"),
    postResponse: async (url, body) => {
      posted.push({ url, body });
    },
    ...overrides,
  };
  return { deps, posted };
}

type PostedResponse = { url: string; body: Record<string, unknown> };
const findEphemeral = (posted: PostedResponse[]) =>
  posted.find((p) => p.body.response_type === "ephemeral");
const findButtonStrip = (posted: PostedResponse[]) =>
  posted.find((p) => p.body.replace_original === true);

test("buildCancelRunActionsBlock carries the action id and run id", () => {
  const block = mod.buildCancelRunActionsBlock("run_xyz") as {
    type: string;
    block_id: string;
    elements: Array<{ action_id: string; value: string; style: string }>;
  };
  assert.equal(block.type, "actions");
  assert.equal(block.block_id, mod.SLACK_RUN_CONTROLS_BLOCK_ID);
  assert.equal(block.elements[0].action_id, mod.SLACK_CANCEL_RUN_ACTION_ID);
  assert.equal(block.elements[0].value, "run_xyz");
  assert.equal(block.elements[0].style, "danger");
});

test("cancels the run and confirms via response_url for a linked user", async () => {
  const cancelCalls: Array<{ userId: string; runId: string }> = [];
  const { deps, posted } = makeDeps({
    cancelRun: async (input) => {
      cancelCalls.push(input);
      return okCancel("cancelled");
    },
  });

  const result = await mod.handleSlackBlockActions(makePayload(), deps);

  assert.deepEqual(result, {
    outcome: "run_cancelled",
    runId: "run_abc",
    status: "cancelled",
  });
  assert.deepEqual(cancelCalls, [{ userId: "mog-user-1", runId: "run_abc" }]);

  const ephemeral = findEphemeral(posted);
  assert.ok(ephemeral);
  assert.equal(ephemeral.url, "https://hooks.slack.test/response");
  assert.match(String(ephemeral.body.text), /run_abc/);

  // The "Cancel run" button is dropped once cancellation is in flight.
  const strip = findButtonStrip(posted);
  assert.ok(strip);
  const stripBlocks = strip.body.blocks as Array<{ block_id?: string }>;
  assert.ok(stripBlocks.length > 0);
  assert.ok(
    stripBlocks.every(
      (block) => block.block_id !== mod.SLACK_RUN_CONTROLS_BLOCK_ID
    )
  );
});

test("ignores payloads without the cancel-run action", async () => {
  const { deps, posted } = makeDeps();
  const result = await mod.handleSlackBlockActions(
    makePayload({ actions: [{ action_id: "something-else", value: "x" }] }),
    deps
  );
  assert.deepEqual(result, { outcome: "ignored", reason: "no_known_action" });
  assert.equal(posted.length, 0);
});

test("ignores actions with a blank run id", async () => {
  const { deps } = makeDeps();
  const result = await mod.handleSlackBlockActions(
    makePayload({
      actions: [{ action_id: mod.SLACK_CANCEL_RUN_ACTION_ID, value: "   " }],
    }),
    deps
  );
  assert.deepEqual(result, { outcome: "ignored", reason: "missing_run_id" });
});

test("ignores non block_actions interactivity types", async () => {
  const { deps } = makeDeps();
  const result = await mod.handleSlackBlockActions(
    makePayload({ type: "view_submission" }),
    deps
  );
  assert.deepEqual(result, {
    outcome: "ignored",
    reason: "unsupported_interactivity_type",
  });
});

test("reports not_linked when the Slack user has no Mogplex mapping", async () => {
  const cancelCalls: unknown[] = [];
  const { deps, posted } = makeDeps({
    getUserMapping: async () => null,
    cancelRun: async (input) => {
      cancelCalls.push(input);
      return okCancel("cancelled");
    },
  });

  const result = await mod.handleSlackBlockActions(makePayload(), deps);

  assert.deepEqual(result, { outcome: "not_linked" });
  assert.equal(cancelCalls.length, 0);
  assert.equal(posted.length, 1);
  assert.match(String(posted[0].body.text), /isn't linked/);
});

test("reports not_linked for legacy email-only Slack mappings", async () => {
  const cancelCalls: unknown[] = [];
  const { deps, posted } = makeDeps({
    getUserMapping: async () =>
      ({
        mogplex_user_id: "mog-user-1",
        link_status: "legacy_email",
      }) as Awaited<ReturnType<SlackInteractivityDeps["getUserMapping"]>>,
    cancelRun: async (input) => {
      cancelCalls.push(input);
      return okCancel("cancelled");
    },
  });

  const result = await mod.handleSlackBlockActions(makePayload(), deps);

  assert.deepEqual(result, { outcome: "not_linked" });
  assert.equal(cancelCalls.length, 0);
  assert.equal(posted.length, 1);
});

test("reports run_not_found when cancel returns null", async () => {
  const { deps, posted } = makeDeps({ cancelRun: async () => null });

  const result = await mod.handleSlackBlockActions(makePayload(), deps);

  assert.deepEqual(result, { outcome: "run_not_found", runId: "run_abc" });
  const ephemeral = findEphemeral(posted);
  assert.ok(ephemeral);
  assert.match(String(ephemeral.body.text), /not found/);
  // The button isn't stripped on the null path — the run may simply not be
  // owned by this user, so leave it for whoever can act on it.
  assert.equal(findButtonStrip(posted), undefined);
});

test("treats an already-finished run as run_not_found", async () => {
  const { deps, posted } = makeDeps({
    cancelRun: async () => okCancel("success", true),
  });

  const result = await mod.handleSlackBlockActions(makePayload(), deps);

  assert.deepEqual(result, { outcome: "run_not_found", runId: "run_abc" });
  const ephemeral = findEphemeral(posted);
  assert.ok(ephemeral);
  assert.match(String(ephemeral.body.text), /already finished/);
  assert.match(String(ephemeral.body.text), /success/);
  // A finished run's button is stale — strip it from the message.
  assert.ok(findButtonStrip(posted));
});

test("treats an already-cancelled run as run_not_found, not run_cancelled", async () => {
  const { deps, posted } = makeDeps({
    cancelRun: async () => okCancel("cancelled", true),
  });

  const result = await mod.handleSlackBlockActions(makePayload(), deps);

  assert.deepEqual(result, { outcome: "run_not_found", runId: "run_abc" });
  const ephemeral = findEphemeral(posted);
  assert.ok(ephemeral);
  assert.match(String(ephemeral.body.text), /already finished/);
  assert.ok(findButtonStrip(posted));
});

test("skips the button strip when the message has no run-controls block", async () => {
  const { deps, posted } = makeDeps({
    cancelRun: async () => okCancel("cancelled", true),
  });

  await mod.handleSlackBlockActions(
    makePayload({ message: { text: "no controls here", blocks: [] } }),
    deps
  );

  assert.equal(findButtonStrip(posted), undefined);
  assert.ok(findEphemeral(posted));
});

test("skips the button strip on a successful cancel when there's no run-controls block", async () => {
  const { deps, posted } = makeDeps({
    cancelRun: async () => okCancel("cancelled"),
  });

  const result = await mod.handleSlackBlockActions(
    makePayload({ message: { text: "no controls here", blocks: [] } }),
    deps
  );

  assert.deepEqual(result, {
    outcome: "run_cancelled",
    runId: "run_abc",
    status: "cancelled",
  });
  assert.equal(findButtonStrip(posted), undefined);
  assert.ok(findEphemeral(posted));
});

test("ignores payloads from an unknown workspace", async () => {
  const { deps, posted } = makeDeps({ getInstallation: async () => null });
  const result = await mod.handleSlackBlockActions(makePayload(), deps);
  assert.deepEqual(result, {
    outcome: "ignored",
    reason: "unknown_workspace",
  });
  assert.equal(posted.length, 0);
});

test("ignores payloads missing the actor team/user", async () => {
  const { deps, posted } = makeDeps();
  const result = await mod.handleSlackBlockActions(
    makePayload({ team: undefined }),
    deps
  );
  assert.deepEqual(result, { outcome: "ignored", reason: "missing_actor" });
  assert.equal(posted.length, 0);
});

test("swallows a failing response_url post", async () => {
  const { deps } = makeDeps({
    postResponse: async () => {
      throw new Error("network down");
    },
  });
  const result = await mod.handleSlackBlockActions(makePayload(), deps);
  assert.deepEqual(result, {
    outcome: "run_cancelled",
    runId: "run_abc",
    status: "cancelled",
  });
});

test("still sends the ephemeral when the button strip POST fails (terminal path)", async () => {
  const posted: PostedResponse[] = [];
  const { deps } = makeDeps({
    cancelRun: async () => okCancel("success", true),
    postResponse: async (url, body) => {
      if (body.replace_original === true) throw new Error("strip failed");
      posted.push({ url, body });
    },
  });

  const result = await mod.handleSlackBlockActions(makePayload(), deps);

  assert.deepEqual(result, { outcome: "run_not_found", runId: "run_abc" });
  const ephemeral = findEphemeral(posted);
  assert.ok(ephemeral);
  assert.match(String(ephemeral.body.text), /already finished/);
});

test("rethrows when cancelRun throws, after notifying the user", async () => {
  const { deps, posted } = makeDeps({
    cancelRun: async () => {
      throw new Error("boom");
    },
  });
  await assert.rejects(
    () => mod.handleSlackBlockActions(makePayload(), deps),
    /boom/
  );
  assert.equal(posted.length, 1);
  assert.match(String(posted[0].body.text), /Couldn't cancel/);
});

test("surfaces a MogplexApiRunControlError message to the user", async () => {
  const { deps, posted } = makeDeps({
    cancelRun: async () => {
      throw new MogplexApiRunControlError("CONFLICT", "run is locked", 409);
    },
  });
  await assert.rejects(
    () => mod.handleSlackBlockActions(makePayload(), deps),
    /run is locked/
  );
  assert.equal(posted.length, 1);
  assert.match(String(posted[0].body.text), /run is locked/);
});
