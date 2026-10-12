import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "yaml";
import githubManifest from "../../github-app-manifest.json";
import { HANDLED_GITHUB_WEBHOOK_EVENTS } from "../../app/api/webhooks/github/_lib/event-handlers";
import { planGithubWebhookSync } from "../../lib/github-webhook-sync";
import { parseCommand } from "../../lib/slack/command-parse";
import { SLACK_BOT_SCOPES } from "../../lib/slack/oauth";

type SlackManifest = {
  features: { slash_commands: { command: string; url: string }[] };
  oauth_config: { redirect_urls: string[]; scopes: { bot: string[] } };
  settings: {
    event_subscriptions: { request_url: string; bot_events: string[] };
    interactivity: { is_enabled: boolean; request_url: string };
  };
};

const slackManifest = parse(
  readFileSync(new URL("../../slack-app-manifest.yml", import.meta.url), "utf8")
) as SlackManifest;

test("Slack manifest requests exactly the bot scopes the OAuth install asks for", () => {
  assert.deepEqual(
    [...slackManifest.oauth_config.scopes.bot].sort(),
    [...SLACK_BOT_SCOPES].sort()
  );
});

test("Slack manifest sends events, commands, and interactivity to the webhook route", () => {
  const webhook = "https://mogplex.example.com/api/webhooks/slack";
  assert.equal(slackManifest.settings.event_subscriptions.request_url, webhook);
  assert.equal(slackManifest.settings.interactivity.request_url, webhook);
  assert.equal(slackManifest.settings.interactivity.is_enabled, true);
  for (const command of slackManifest.features.slash_commands) {
    assert.equal(command.url, webhook, command.command);
  }
  assert.deepEqual(slackManifest.oauth_config.redirect_urls, [
    "https://mogplex.example.com/api/integrations/slack/callback",
  ]);
});

test("Slack manifest registers only slash commands the webhook parses", () => {
  for (const { command } of slackManifest.features.slash_commands) {
    assert.notEqual(parseCommand({ command, text: "" }), null, command);
  }
});

test("GitHub manifest subscribes to every event that can start work", () => {
  const subscribed = new Set(githubManifest.default_events);
  for (const event of HANDLED_GITHUB_WEBHOOK_EVENTS) {
    assert.ok(subscribed.has(event), `missing GitHub event: ${event}`);
  }
});

test("GitHub manifest subscribes to repository events used for repo sync", () => {
  assert.ok(githubManifest.default_events.includes("repository"));
  const plan = planGithubWebhookSync("repository", {
    action: "renamed",
    installation: { id: 1 },
    repository: { id: 2, full_name: "acme/web", name: "web" },
  });
  assert.equal(plan.type, "repository");
});
