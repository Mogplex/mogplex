# Durable Slack and GitHub webhook ingress

This rollout keeps the Slack and GitHub provider URLs on Mogplex's existing
`/api/webhooks/slack` and `/api/webhooks/github` routes. An optional extra hop
forwards eligible requests, with their original signed bytes and headers, to
Trigger.dev's hosted endpoints. The edge acknowledges only after hosted
acceptance. Native subscribers then run the same authorized application
dispatchers as the legacy routes; this does not replace Mogplex's agent runtime.

Both flags default off. Merging or deploying the code alone does not switch
provider traffic. SDK, build extension and Slack source packages are aligned at
4.8.3; the repository's `pnpm trigger:*` wrapper selects the matching CLI.

## Traffic boundaries

| Traffic | With the corresponding flag enabled |
| --- | --- |
| Slack human message / mention events | Forward to `mogplex-slack-ingress`; the existing event task keeps its event-ID idempotency and conversation concurrency key. |
| Slack commands except help and issue-create modal | Forward to the same endpoint, then use the existing command handler and installation/user checks. |
| Slack reviewed nonmodal button actions | Forward to the same endpoint. The runtime action allowlist is in `slack/_lib/native-input.ts`. |
| Slack help, issue creation, modal submissions, run details/changes, checkpoint revise, connection recovery and unknown new actions | Keep the existing edge behavior because responses or `trigger_id` calls can have short deadlines. |
| Slack work-object/unfurl events and URL-verification challenge | Keep the existing edge handling. |
| GitHub requests signed by `GITHUB_WEBHOOK_SECRET` | Forward to `mogplex-github-ingress`; existing installation/repository/flow checks still apply. |
| GitHub per-repository-secret fallback when no global app secret is configured | Keep the original authenticated route. A single hosted source cannot verify those different secrets. |

Signature checks happen at the edge and again against the original bytes at
hosted ingress. Subscribers never synthesize signatures or expose an HTTP
verification bypass. Runtime shape/event checks remain necessary even with
hosted filtering. Application database idempotency and tenant checks remain
authoritative; hosted deduplication has finite windows.

## Retry and failure behavior

Forwarding uses a 2-second Slack / 8-second GitHub deadline. It does not retry,
follow redirects or fall back to local dispatch after an ambiguous timeout.
Such a timeout might mean Trigger already accepted the event. A failed receipt
returns 503 with a generic error and logs only the provider name.

**GitHub does not automatically redeliver failed webhook deliveries.** If the
edge fails before durable receipt, an operator must inspect GitHub's delivery
history and Trigger's delivery records before choosing a targeted redelivery.
Slack's event delivery retry behavior does not imply automatic retries for
every slash-command or interaction request.

After durable receipt, native subscribers retry up to three attempts for
idempotent Slack event enqueue, pre-claim Slack lookups, and GitHub dispatch. GitHub duplicate domain
jobs reuse the existing database identity; the existing atomic pending-job
claim prevents restarting running/completed work. Partial wait completion is
retried only for waits still waiting. If completion and its rollback both
fail, the native task stops visibly for operator repair rather than retrying
into a misleading zero-match success.

Slack command and button effects are single-attempt because not all of their
side effects are idempotent. Transient failures before a receipt is claimed
can retry safely; an uncertain existing claim aborts the retry. Before dispatch, authorized commands and actions
reserve an entry in the existing service-only `slack_tool_executions` ledger,
keyed by the Slack team, actor, delivery kind and a hash of the signed body.
Retry timestamps and signatures do not affect this identity; distinct clicks
or command invocations do. A duplicate completed dispatch is skipped. A prior
started or failed dispatch aborts visibly for inspection, including when an
effect succeeded but persisting completion failed. Receipt keys contain no
response URLs, credentials or message contents. These entries follow the
ledger's existing 24-hour retention, so later manual replay still needs an
effect audit. Unlinked actors reach only the existing authorization/linking
response. Message tasks use an explicitly global event key across native runs.
Unclassifiable hosted Slack payloads abort visibly without logging their content.
A failed task remains recorded for deliberate recovery. Inspect prior effects before any replay or retry; do not replay a
historical backlog automatically. Delivery `SUCCEEDED` confirms routing, not
completion of the subscriber or the downstream agent/job.

## Staged activation

1. Complete PR review and normal release checks. Deploy the matching app commit
   and Trigger worker through the existing release process. A local
   `pnpm trigger:deploy -- --dry-run --skip-sync-env-vars` validates the bundle
   without deploying it. Do not enable either flag during this phase.
2. In the target Trigger environment, inspect endpoints
   `mogplex-slack-ingress` and `mogplex-github-ingress`. Store the existing
   provider signing secret on the respective endpoint. Do not put secrets in
   the URL, repository, logs, or copied setup instructions.
3. Copy that environment's hosted URL into its corresponding **server-only**
   Vercel variable: `TRIGGER_SLACK_WEBHOOK_URL` or
   `TRIGGER_GITHUB_WEBHOOK_URL`. Activate one provider at a time. Match the
   URL's origin to `TRIGGER_API_URL` (default `https://api.trigger.dev`), with no
   credentials, query or fragment. Do not point previews at production ingress.
   Redeploy the app to apply the variable.
4. Keep the provider's configured URL on the existing Mogplex route. Check a
   controlled event's edge receipt, native delivery, subscriber run, and
   downstream task/job separately. Verify duplicate redelivery does not create
   a second domain job or agent turn; verify help/modal/unfurl behavior still
   works and a tenant mismatch cannot reach another installation's work.
5. Observe failures and routing diagnostics before enabling the other provider.

No new bot permissions, OAuth scopes, bot identities, billing flows, schema
migrations or provider subscriptions are required for this transport change.

## Rollback and recovery

Unset only the affected `TRIGGER_*_WEBHOOK_URL` variable and redeploy the app.
New requests then use the existing legacy path. Do not replay already accepted
deliveries just because the flag was removed. Inspect/drain native runs already
accepted; legacy and native event IDs/database keys remain the duplicate guards
across the transition. Keep endpoints available until accepted work finishes.

For a stranded wait rollback failure, inspect the wait row, token state and
prior downstream effects before repairing that one wait and retrying its
delivery. Do not clear installation state or replay unrelated events.

References: [Trigger beta requirements](https://trigger.dev/docs/webhooks/public-beta),
[hosted delivery semantics](https://trigger.dev/docs/webhooks/deliveries),
[GitHub failed-delivery handling](https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries).
