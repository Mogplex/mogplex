import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCancelRunActionsBlock,
  buildRepoAgentRunFinishedText,
  buildRepoAgentRunStartedText,
  buildTextSectionBlocks,
  isRunControlsBlock,
  readSlackRunControlsMetadata,
  SLACK_CANCEL_RUN_ACTION_ID,
  SLACK_RUN_CONTROLS_BLOCK_ID,
  SLACK_RUN_CONTROLS_METADATA_KEY,
} from "../../lib/slack/run-controls";
import { stripSlackRunControlsForTerminalRun } from "../../lib/slack/run-controls-notify";
import type { UpdateSlackMessageInput } from "../../lib/slack/client";

test("buildCancelRunActionsBlock carries the action id, block id, and run id", () => {
  const block = buildCancelRunActionsBlock("run_xyz") as {
    block_id: string;
    elements: Array<{ action_id: string; value: string }>;
  };
  assert.equal(block.block_id, SLACK_RUN_CONTROLS_BLOCK_ID);
  assert.equal(block.elements[0].action_id, SLACK_CANCEL_RUN_ACTION_ID);
  assert.equal(block.elements[0].value, "run_xyz");
  assert.ok(isRunControlsBlock(block));
  assert.ok(!isRunControlsBlock({ type: "section" }));
});

test("buildRepoAgentRunStartedText links to the run", () => {
  const text = buildRepoAgentRunStartedText(
    "run-1",
    "https://app.test/runs/run-1"
  );
  assert.match(text, /Started run `run-1`/);
  assert.match(text, /<https:\/\/app\.test\/runs\/run-1\|view in Mogplex>/);
});

test("buildRepoAgentRunFinishedText varies copy by terminal status", () => {
  const url = "https://app.test/runs/run-1";
  assert.match(
    buildRepoAgentRunFinishedText("run-1", url, "success"),
    /finished/
  );
  assert.match(buildRepoAgentRunFinishedText("run-1", url, "failed"), /failed/);
  assert.match(
    buildRepoAgentRunFinishedText("run-1", url, "cancelled"),
    /cancelled/
  );
  // Unknown statuses still produce a link-bearing line.
  assert.match(
    buildRepoAgentRunFinishedText("run-1", url, "weird"),
    /status: weird/
  );
  assert.match(buildRepoAgentRunFinishedText("run-1", url, "success"), /run-1/);
});

test("buildTextSectionBlocks reduces message text to a single mrkdwn section", () => {
  const blocks = buildTextSectionBlocks("hello");
  assert.deepEqual(blocks, [
    { type: "section", text: { type: "mrkdwn", text: "hello" } },
  ]);
  assert.equal(buildTextSectionBlocks(""), null);
});

test("stripSlackRunControlsForTerminalRun sends a non-empty blocks array", async () => {
  const updates: Array<{ botToken: string; input: UpdateSlackMessageInput }> =
    [];
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

  try {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.test";
    await stripSlackRunControlsForTerminalRun(
      {
        id: "run-1",
        metadata: {
          [SLACK_RUN_CONTROLS_METADATA_KEY]: {
            teamId: "T1",
            channelId: "C1",
            messageTs: "1700000000.0001",
          },
        },
      },
      "success",
      {
        getSlackBotToken: async (teamId) => {
          assert.equal(teamId, "T1");
          return "xoxb-token";
        },
        updateSlackMessage: async (botToken, input) => {
          updates.push({ botToken, input });
        },
      }
    );
  } finally {
    if (originalAppUrl === undefined) {
      delete process.env.NEXT_PUBLIC_APP_URL;
    } else {
      process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
    }
  }

  assert.equal(updates.length, 1);
  assert.equal(updates[0]?.botToken, "xoxb-token");
  assert.equal(updates[0]?.input.channel, "C1");
  assert.equal(updates[0]?.input.ts, "1700000000.0001");
  assert.match(updates[0]?.input.text ?? "", /Run finished/);
  assert.equal(updates[0]?.input.blocks?.[0].type, "header");
  assert.ok(
    !JSON.stringify(updates[0]?.input.blocks).includes(
      SLACK_CANCEL_RUN_ACTION_ID
    )
  );
});

test("readSlackRunControlsMetadata only accepts complete coordinates", () => {
  const ok = readSlackRunControlsMetadata({
    [SLACK_RUN_CONTROLS_METADATA_KEY]: {
      teamId: "T1",
      channelId: "C1",
      messageTs: "1700000000.0001",
    },
    source: "external-api",
  });
  assert.deepEqual(ok, {
    teamId: "T1",
    channelId: "C1",
    messageTs: "1700000000.0001",
  });

  assert.equal(readSlackRunControlsMetadata(null), null);
  assert.equal(readSlackRunControlsMetadata({}), null);
  assert.equal(readSlackRunControlsMetadata("nope"), null);
  assert.equal(
    readSlackRunControlsMetadata({
      [SLACK_RUN_CONTROLS_METADATA_KEY]: { teamId: "T1", channelId: "C1" },
    }),
    null
  );
  assert.equal(
    readSlackRunControlsMetadata({
      [SLACK_RUN_CONTROLS_METADATA_KEY]: {
        teamId: "",
        channelId: "C1",
        messageTs: "1.0",
      },
    }),
    null
  );
});

test("stripSlackRunControlsForTerminalRun links the pull request from a successful run's output", async () => {
  const updates: UpdateSlackMessageInput[] = [];
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

  try {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.test";
    await stripSlackRunControlsForTerminalRun(
      {
        id: "run-2",
        ai_call_id: "call-2",
        user_id: "user-1",
        metadata: {
          [SLACK_RUN_CONTROLS_METADATA_KEY]: {
            teamId: "T1",
            channelId: "D1",
            messageTs: "1700000000.0002",
          },
        },
      },
      "success",
      {
        getSlackBotToken: async () => "xoxb-token",
        updateSlackMessage: async (_botToken, input) => {
          updates.push(input);
        },
        loadEvidence: async () => ({
          github: {
            checked: true,
            branch: null,
            pullRequests: [
              {
                number: 7,
                state: "open",
                url: "https://github.com/acme/widgets/pull/7",
              },
            ],
          },
          workspace: null,
        }),
        loadRunOutput: async (run) => {
          assert.equal(run.ai_call_id, "call-2");
          return "Fixed it and opened https://github.com/acme/widgets/pull/7 for review.";
        },
      }
    );
  } finally {
    if (originalAppUrl === undefined) {
      delete process.env.NEXT_PUBLIC_APP_URL;
    } else {
      process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
    }
  }

  assert.equal(updates.length, 1);
  assert.match(updates[0].text, /Run finished/);
  assert.match(
    updates[0].text,
    /PR #7 · open\nhttps:\/\/github\.com\/acme\/widgets\/pull\/7/
  );
  assert.match(updates[0].text, /Fixed it and opened/);
  assert.equal(updates[0].channel, "D1");
});

test("stripSlackRunControlsForTerminalRun ignores output loading failures", async () => {
  const updates: UpdateSlackMessageInput[] = [];
  const originalWarn = console.warn;
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  console.warn = () => undefined;
  process.env.NEXT_PUBLIC_APP_URL = "https://app.test";
  try {
    await stripSlackRunControlsForTerminalRun(
      {
        id: "run-3",
        metadata: {
          [SLACK_RUN_CONTROLS_METADATA_KEY]: {
            teamId: "T1",
            channelId: "D1",
            messageTs: "1700000000.0003",
          },
        },
      },
      "success",
      {
        getSlackBotToken: async () => "xoxb-token",
        updateSlackMessage: async (_botToken, input) => {
          updates.push(input);
        },
        loadRunOutput: async () => {
          throw new Error("events unavailable");
        },
      }
    );
  } finally {
    console.warn = originalWarn;
    if (originalAppUrl === undefined) {
      delete process.env.NEXT_PUBLIC_APP_URL;
    } else {
      process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
    }
  }

  assert.equal(updates.length, 1);
  assert.match(updates[0].text, /Run finished/);
});
