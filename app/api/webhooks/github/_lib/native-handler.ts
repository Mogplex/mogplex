import { AbortTaskRunError } from "@trigger.dev/sdk";
import { z } from "zod";
import { HANDLED_GITHUB_WEBHOOK_EVENTS } from "./event-handlers";
import { loadWebhookRepoRows } from "./data-loaders";
import { parseWebhookRequestBody } from "./request-context";
import { dispatchVerifiedGithubWebhook } from "./verified-dispatch";

const EVENTS = new Set([
  ...HANDLED_GITHUB_WEBHOOK_EVENTS,
  "installation",
  "installation_repositories",
  "repository",
  "deployment_status",
]);
const bodySchema = z
  .object({
    installation: z.object({ id: z.number().int().positive() }).passthrough(),
    repository: z
      .object({
        id: z.number().int().positive(),
        full_name: z.string().min(1),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

/** Called only with an event already verified by the hosted GitHub source.
 * Never reconstruct a provider signature or expose this as an HTTP bypass.
 */
export async function handleNativeGithubWebhook(
  event: unknown,
  headers: Headers
) {
  const eventName = headers.get("x-github-event");
  if (!eventName || !EVENTS.has(eventName)) return;
  const deliveryId = headers.get("x-github-delivery")?.trim();
  const body = bodySchema.safeParse(event);
  if (!body.success || !deliveryId) {
    throw new AbortTaskRunError("Invalid GitHub webhook identity");
  }
  const context = parseWebhookRequestBody({
    event: eventName,
    deliveryId,
    payload: JSON.stringify(body.data),
    // Signature verification already happened against the original bytes.
    signature: "",
    globalSecret: null,
  });
  const repos = await loadWebhookRepoRows(
    context.repoGithubId,
    context.installationId,
    true
  );
  const response = await dispatchVerifiedGithubWebhook(context, repos, true);
  if (!response.ok) throw new Error("GitHub webhook handling failed");
}
