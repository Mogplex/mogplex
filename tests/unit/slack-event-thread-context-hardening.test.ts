import assert from "node:assert/strict";
import test, { after } from "node:test";
import { resolveKnownSlackAttribution } from "@/trigger/slack-event-lib/attribution";
import {
  extractSlackBareRepoNameCandidates,
  extractSlackRepoCandidates,
} from "@/trigger/slack-event-lib/repo-context";
import { buildSlackThreadContext } from "@/trigger/slack-event-lib/thread-context";
import {
  baseInstallation,
  basePayload,
  restoreFetch,
} from "./helpers/slack-event-task-fixtures";

after(() => {
  restoreFetch();
});

test("installer fallback applies only to the installation's authed Slack user", () => {
  assert.deepEqual(
    resolveKnownSlackAttribution({
      installation: baseInstallation,
      slackUserId: "USLACK-INSTALLER",
      existing: null,
    }),
    {
      mode: "installer_fallback",
      mogplexUserId: "installer-user",
      slackEmail: null,
    }
  );
  assert.equal(
    resolveKnownSlackAttribution({
      installation: baseInstallation,
      slackUserId: "UOTHER-WORKSPACE-MEMBER",
      existing: null,
    }),
    null
  );
});

test("bounds repo candidates and ignores GitHub-like subdomains", () => {
  assert.deepEqual(
    extractSlackRepoCandidates([
      "https://gist.github.com/not/a-repo",
      "https://nogithub.com/not/a-repo",
      ...Array.from(
        { length: 12 },
        (_, index) => `owner-${index}/repo-${index}`
      ),
    ]),
    Array.from({ length: 10 }, (_, index) => `owner-${index}/repo-${index}`)
  );
});

test("extracts bare repo names, newest text first, without URLs or short noise", () => {
  assert.deepEqual(
    extractSlackBareRepoNameCandidates([
      "Please fix this in widgets: https://widgets.example/app/preview at 2:30 PM",
      "See https://github.com/acme/widgets/issues/1 and Widgets again.",
      "Then mogplex.",
    ]),
    [
      "Please",
      "fix",
      "this",
      "widgets",
      "See",
      "and",
      "again",
      "Then",
      "mogplex",
    ]
  );
});

test("bounds bare repo name candidates", () => {
  assert.equal(
    extractSlackBareRepoNameCandidates([
      Array.from({ length: 60 }, (_, index) => `word${index}`).join(" "),
    ]).length,
    40
  );
});

test("drops thread images outside the Slack download allowlist", async (t) => {
  let fetched = false;
  const warn = t.mock.method(console, "warn", () => undefined);
  const context = await buildSlackThreadContext({
    deps: {
      getThreadMessages: async () => [
        {
          type: "message",
          user: "UCHARLES",
          ts: "1700000000.000100",
          text: "inspect this image",
          files: [
            {
              id: "F-UNTRUSTED",
              mimetype: "image/png",
              url_private_download: "https://example.com/files-pri/secret.png",
            },
          ],
        },
      ],
      fetchAttachment: async () => {
        fetched = true;
        throw new Error("untrusted URL should not be fetched");
      },
    },
    botToken: "xoxb-test",
    payload: {
      ...basePayload,
      channelType: "channel",
      eventType: "app_mention",
      messageTs: "1700000099.000100",
    },
  });

  assert.equal(fetched, false);
  assert.equal(typeof context.contextMessage?.content, "string");
  assert.equal(warn.mock.callCount(), 1);
});

test("reports incomplete prior image context to the agent", async (t) => {
  t.mock.method(console, "warn", () => undefined);
  const files = Array.from({ length: 5 }, (_, index) => ({
    id: `F${index + 1}`,
    mimetype: "image/png",
    url_private_download: `https://files.slack.com/files-pri/T-F${index + 1}/image.png`,
  }));
  let fetchCount = 0;
  const context = await buildSlackThreadContext({
    deps: {
      getThreadMessages: async () => [
        {
          type: "message",
          user: "UCHARLES",
          ts: "1700000000.000100",
          text: "inspect these images",
          files,
        },
      ],
      fetchAttachment: async () => {
        fetchCount += 1;
        if (fetchCount === 1) throw new Error("Slack download failed");
        return new Response(Buffer.from([1, 2, 3]), {
          headers: { "content-type": "image/png", "content-length": "3" },
        });
      },
    },
    botToken: "xoxb-test",
    payload: {
      ...basePayload,
      channelType: "channel",
      eventType: "app_mention",
      messageTs: "1700000099.000100",
    },
  });

  assert.equal(fetchCount, 4);
  assert.ok(Array.isArray(context.contextMessage?.content));
  const textPart = context.contextMessage?.content[0];
  assert.equal(textPart?.type, "text");
  assert.match(textPart.text, /couldn't load attached image/);
  assert.match(textPart.text, /showing first 4 of 5 attached images/);
});
