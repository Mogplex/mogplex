import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSandboxRouteParams,
  buildSandboxRouteRequest,
} from "./sandbox-record-route-test-harness";
import {
  buildSandboxServiceAiAccess,
  buildOwnedSandboxServiceRecord,
  buildSandboxServiceRouteAuth,
  loadSandboxHarnessRouteModule,
} from "./sandbox-service-route-test-harness";
import {
  materializeSlackImageAttachmentsForHarness,
  normalizeSlackRunImageAttachmentsMetadata,
  type SlackRunImageAttachmentsMetadata,
} from "../../lib/slack/run-attachments";
import { isClosedSandboxStreamError } from "../../app/api/sandbox/[id]/harness/route";

test("closed sandbox streams are recognized for lifecycle reconciliation", () => {
  assert.equal(
    isClosedSandboxStreamError(
      new Error("Sandbox stream was closed and is not accepting commands.")
    ),
    true
  );
  assert.equal(
    isClosedSandboxStreamError(new Error("Provider returned 429")),
    false
  );
});

test("POST /api/sandbox/[id]/harness fails clearly when neither gateway nor provider credentials exist", async () => {
  const { createSandboxHarnessPostHandler } =
    await loadSandboxHarnessRouteModule();

  const handler = createSandboxHarnessPostHandler({
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    loadOwnedSandboxRecord: async () => buildOwnedSandboxServiceRecord(),
    resolveSandboxAiAccess: async () => buildSandboxServiceAiAccess(),
    getSandbox: async () => {
      throw new Error("getSandbox should not be called");
    },
    runHarness: async () => {
      throw new Error("runHarness should not be called");
    },
  });

  const response = await handler(
    buildSandboxRouteRequest({
      method: "POST",
      suffix: "/harness",
      init: {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          harness: "claude-code",
          prompt: "Review this repo",
        }),
      },
    }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error:
      "No Anthropic API key configured. Add one in Settings > API Keys or configure an AI Gateway key.",
  });
});

test("materializeSlackImageAttachmentsForHarness writes Slack images into the sandbox", async () => {
  const writes: Array<{ path: string; content: Buffer }> = [];
  const result = await materializeSlackImageAttachmentsForHarness({
    deps: {
      getSlackBotToken: async (teamId) => {
        assert.equal(teamId, "T1");
        return "xoxb-test";
      },
      fetchSlackAttachment: async (input) => {
        assert.equal(input.botToken, "xoxb-test");
        assert.equal(input.url, "https://files.slack.com/files-pri/T-F1/png");
        assert.equal(input.signal.aborted, false);
        return new Response(Buffer.from("image-bytes"), {
          headers: { "content-length": "11" },
        });
      },
    },
    sandbox: {
      async readFile() {
        throw new Error("missing");
      },
      async writeFiles(entries) {
        writes.push(...entries);
      },
    },
    rootDirectory: "apps/web",
    attachments: {
      teamId: "T1",
      files: [
        {
          id: "F1",
          mimetype: "image/png",
          urlPrivateDownload: "https://files.slack.com/files-pri/T-F1/png",
          name: "screen shot.png",
          sizeBytes: 11,
        },
      ],
    },
  });

  assert.deepEqual(
    writes.map((write) => write.path),
    [
      "apps/web/.mogplex/.gitignore",
      "apps/web/.mogplex/slack-attachments/01-screen_shot.png",
    ]
  );
  assert.equal(writes[0]?.content.toString(), "*\n");
  assert.equal(writes[1]?.content.toString(), "image-bytes");
  assert.equal(
    result.writtenFiles[0]?.path,
    ".mogplex/slack-attachments/01-screen_shot.png"
  );
  assert.match(
    result.promptSection ?? "",
    /\.mogplex\/slack-attachments\/01-screen_shot\.png/
  );
});

test("normalizeSlackRunImageAttachmentsMetadata accepts slack.com download URLs", () => {
  const metadata = normalizeSlackRunImageAttachmentsMetadata({
    teamId: "T1",
    files: [
      {
        id: "F1",
        mimetype: "image/png",
        urlPrivateDownload:
          "https://slack.com/files-pri/T024BE7LD-F024BERPE/download/1.png",
      },
    ],
  });

  assert.deepEqual(metadata, {
    teamId: "T1",
    files: [
      {
        id: "F1",
        mimetype: "image/png",
        urlPrivateDownload:
          "https://slack.com/files-pri/T024BE7LD-F024BERPE/download/1.png",
      },
    ],
  });
});

test("normalizeSlackRunImageAttachmentsMetadata rejects non-Slack download URLs", (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const metadata = normalizeSlackRunImageAttachmentsMetadata({
    teamId: "T1",
    files: [
      {
        id: "F1",
        mimetype: "image/png",
        urlPrivateDownload: "https://example.com/steal-token",
      },
    ],
  });

  assert.equal(metadata, null);
  assert.equal(warn.mock.callCount(), 1);
  assert.equal(
    warn.mock.calls[0]?.arguments[0],
    "[slack-run-attachments] dropped all Slack image attachments metadata"
  );
  assert.deepEqual(warn.mock.calls[0]?.arguments[1], { fileCount: 1 });
});

test("materializeSlackImageAttachmentsForHarness treats missing Slack tokens as unavailable", async (t) => {
  const writes: Array<{ path: string; content: Buffer }> = [];
  const warn = t.mock.method(console, "warn", () => {});
  const attachments = {
    teamId: "T1",
    files: [
      {
        id: "F1",
        mimetype: "image/png",
        urlPrivateDownload: "https://files.slack.com/files-pri/T-F1/png",
        sizeBytes: 11,
      },
      {
        id: "F2",
        mimetype: "image/jpeg",
        urlPrivateDownload: "https://files.slack.com/files-pri/T-F2/jpg",
        sizeBytes: 12,
      },
    ],
  } satisfies SlackRunImageAttachmentsMetadata;
  const result = await materializeSlackImageAttachmentsForHarness({
    deps: {
      getSlackBotToken: async () => {
        throw new Error("vault unavailable");
      },
      fetchSlackAttachment: async () => {
        throw new Error("should not fetch without a token");
      },
    },
    sandbox: {
      async readFile() {
        throw new Error("should not read when token is unavailable");
      },
      async writeFiles(entries) {
        writes.push(...entries);
      },
    },
    rootDirectory: "apps/web",
    attachments,
  });

  assert.deepEqual(writes, []);
  assert.deepEqual(result.writtenFiles, []);
  assert.equal(result.droppedCount, 0);
  assert.equal(result.unavailableCount, attachments.files.length);
  assert.match(result.promptSection ?? "", /could not save any/);
  assert.match(
    result.promptSection ?? "",
    /2 Slack image attachment\(s\) could not be downloaded/
  );
  assert.equal(warn.mock.callCount(), 1);
  assert.equal(
    warn.mock.calls[0]?.arguments[0],
    "[harness] failed to load Slack bot token for attachments"
  );
  assert.deepEqual(warn.mock.calls[0]?.arguments[1], {
    teamId: "T1",
    error: { name: "Error", message: "vault unavailable" },
  });
});
