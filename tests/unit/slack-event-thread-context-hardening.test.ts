import assert from "node:assert/strict";
import test, { after } from "node:test";
import { resolveKnownSlackAttribution } from "@/trigger/slack-event-lib/attribution";
import { extractSlackRepoCandidates } from "@/trigger/slack-event-lib/repo-context";
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
