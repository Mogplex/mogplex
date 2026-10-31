import {
  isKnownAccountType,
  normalizeAccountType,
} from "@/lib/flows/trigger-filter";
import type { TriggerFilterAccountType } from "@/lib/flows/trigger-filter";
import type {
  RawWebhookRequestContext,
  WebhookPayloadBody,
  WebhookRequestContext,
} from "./types";

function readWebhookInstallationId(body: WebhookPayloadBody) {
  return body.installation?.id ?? null;
}

function readWebhookRepoGithubId(body: WebhookPayloadBody) {
  return typeof body.repository?.id === "number" ? body.repository.id : null;
}

function readWebhookRepoFullName(body: WebhookPayloadBody) {
  return typeof body.repository?.full_name === "string"
    ? body.repository.full_name
    : null;
}

export async function parseWebhookRequest(
  request: Request
): Promise<RawWebhookRequestContext> {
  return {
    event: request.headers.get("x-github-event"),
    deliveryId: request.headers.get("x-github-delivery")?.trim() || null,
    signature: request.headers.get("x-hub-signature-256") || "",
    globalSecret: process.env.GITHUB_WEBHOOK_SECRET?.trim() || null,
    payload: await request.text(),
  };
}

function readWebhookAccountType(
  body: WebhookPayloadBody
): TriggerFilterAccountType {
  const raw =
    body.installation?.target_type ?? body.installation?.account?.type;
  const normalized = normalizeAccountType(raw);
  if (
    typeof raw === "string" &&
    raw.trim() !== "" &&
    !isKnownAccountType(raw)
  ) {
    console.warn(
      JSON.stringify({
        event: "webhook_account_type_unknown",
        raw,
        installation_id: readWebhookInstallationId(body),
        fallback: normalized,
      })
    );
  }
  return normalized;
}

export function parseWebhookRequestBody(
  context: RawWebhookRequestContext
): WebhookRequestContext {
  const body = JSON.parse(context.payload) as WebhookPayloadBody;

  return {
    event: context.event,
    deliveryId: context.deliveryId,
    signature: context.signature,
    globalSecret: context.globalSecret,
    payload: context.payload,
    body,
    installationId: readWebhookInstallationId(body),
    repoGithubId: readWebhookRepoGithubId(body),
    repoFullName: readWebhookRepoFullName(body),
    accountType: readWebhookAccountType(body),
  };
}
