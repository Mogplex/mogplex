import { AbortTaskRunError } from "@trigger.dev/sdk";
import { parseNativeSlackEvent } from "@/app/api/webhooks/slack/_lib/native-input";
import { dispatchVerifiedSlackWebhook } from "@/app/api/webhooks/slack/_lib/verified-dispatch";
import { hashToolInput } from "@/lib/agents/slack-tool-idempotency";
import { supabaseSlackToolExecutionStore as store } from "@/lib/agents/slack-tool-idempotency-store";
import { resolveSlackCommandUserId } from "./command-identity";
import {
  getSlackInstallationByTeamId,
  getSlackUserMapping,
} from "./installations";

export async function dispatchNativeSlackWebhook(
  event: unknown
): Promise<void> {
  const input = parseNativeSlackEvent(event);
  if (!input) throw new AbortTaskRunError("Slack delivery is not classifiable");
  if (input.kind === "event") return dispatchVerifiedSlackWebhook(input);

  const teamId =
    input.kind === "command" ? input.body.teamId : input.body.team?.id;
  const slackUserId =
    input.kind === "command" ? input.body.slackUserId : input.body.user?.id;
  if (!teamId || !slackUserId)
    throw new AbortTaskRunError("Slack delivery identity is missing");
  const installation = await getSlackInstallationByTeamId(teamId);
  if (!installation) return dispatchVerifiedSlackWebhook(input);
  const mapping = await getSlackUserMapping({
    installationId: installation.id,
    slackUserId,
  });
  const userId = resolveSlackCommandUserId(installation, mapping, slackUserId);
  // The existing handler still owns authorization and its account-linking reply.
  if (!userId) return dispatchVerifiedSlackWebhook(input);

  // Signed body identity stays stable when retry timestamps/signatures change.
  // Keep the durable claim even if effects or completion fail: a failed task's
  // Trigger idempotency key alone would be cleared and permit another attempt.
  const inputHash = hashToolInput(input.body);
  const reservation = await store.reserve({
    userId,
    scopeKey: `slack-webhook:${teamId}:${slackUserId}`,
    toolName: `slack_webhook_${input.kind}`,
    inputHash,
    occurrence: 1,
  });
  if (!reservation.acquired) {
    if (reservation.record.status === "completed") return;
    throw new AbortTaskRunError(
      "Slack delivery was already attempted; inspect its execution receipt"
    );
  }
  try {
    await dispatchVerifiedSlackWebhook(input);
    // Completed means dispatched once. Handlers can report a business failure
    // to Slack without throwing, so this receipt does not certify its outcome.
    await store.complete({ executionId: reservation.record.id, output: null });
  } catch (error) {
    try {
      await store.fail({
        executionId: reservation.record.id,
        error: "Native Slack dispatch failed; inspect the original run",
      });
    } catch {
      console.error("[native-webhook] Slack execution receipt needs review", {
        executionId: reservation.record.id,
      });
    }
    throw error;
  }
}
