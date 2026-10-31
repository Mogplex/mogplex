import { AbortTaskRunError, webhook, webhooks } from "@trigger.dev/sdk";
import { webhookSource } from "@trigger.dev/slack";
import { parseNativeSlackEvent } from "@/app/api/webhooks/slack/_lib/native-input";
import { dispatchVerifiedSlackWebhook } from "@/app/api/webhooks/slack/_lib/verified-dispatch";
import { handleNativeGithubWebhook } from "@/app/api/webhooks/github/_lib/native-handler";

export const slackIngress = webhooks.endpoint.define({
  id: "mogplex-slack-ingress",
  source: webhookSource<unknown>(),
});
export const githubIngress = webhooks.endpoint.define({
  id: "mogplex-github-ingress",
  source: webhooks.github<unknown>(),
});

export const receiveSlackWebhook = webhook({
  id: "receive-slack-webhook",
  endpoint: slackIngress,
  maxDuration: 120,
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 1_000,
    maxTimeoutInMs: 10_000,
    factor: 2,
  },
  // Retrying message enqueue is safe via slack-event:{event_id}. Commands and
  // button handlers can have non-idempotent side effects: keep their failed
  // runs visible for deliberate recovery instead of blindly repeating them.
  catchError: ({ payload }) => {
    if (parseNativeSlackEvent(payload.event)?.kind !== "event")
      return { skipRetrying: true };
  },
  onEvent: async ({ event, endpoint }) => {
    if (endpoint?.declaredId !== slackIngress.id) {
      throw new AbortTaskRunError(
        "A verified Slack endpoint delivery is required"
      );
    }
    const input = parseNativeSlackEvent(event);
    if (input) await dispatchVerifiedSlackWebhook(input);
  },
});

export const receiveGithubWebhook = webhook({
  id: "receive-github-webhook",
  endpoint: githubIngress,
  maxDuration: 120,
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 1_000,
    maxTimeoutInMs: 10_000,
    factor: 2,
  },
  onEvent: async ({ event, headers, endpoint }) => {
    if (endpoint?.declaredId !== githubIngress.id) {
      throw new AbortTaskRunError(
        "A verified GitHub endpoint delivery is required"
      );
    }
    await handleNativeGithubWebhook(event, headers);
  },
});
