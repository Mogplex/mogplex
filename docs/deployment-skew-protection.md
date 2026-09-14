# Deployment skew protection

Each production app release sends tasks to the Trigger.dev worker built from the same commit. Older app releases retain their own task release.

The production workflow sets `TRIGGER_EXTERNAL_DEPLOYMENT_ID` through Vercel's runtime `--env` option. The Trigger GitHub integration supplies the same commit SHA on every deploy. The workflow clears `TRIGGER_VERSION`, because that older setting overrides the commit pin. The browser's `MOGPLEX_DEPLOYMENT_ID` remains separate.

The lifecycle hooks in `trigger/init.ts` pin child tasks to the worker's own version. This also covers fire-and-forget tasks, which Trigger does not automatically lock. Local development clears release pins.

For manual releases, deploy the tasks with `pnpm trigger:deploy -- --external-id "$(git rev-parse HEAD)"`. Set the app's runtime `TRIGGER_EXTERNAL_DEPLOYMENT_ID` to that same SHA.

For previews, first create a Trigger branch with the same commit. Then turn on automatic skew protection. Use that branch's credentials and `TRIGGER_AUTOMATIC_SKEW_VERSION_PROTECTION=1` with the runtime `VERCEL_GIT_COMMIT_SHA`. The production workflow does not configure preview deployments.

Every app commit needs a task deployment. Do not filter task builds by changed paths. Requests wait for the worker with that commit. They expire if it never arrives. See [Trigger.dev's documentation](https://trigger.dev/docs/deployment/version-skew-protection).

## Browser requests and schema failures

Browser API requests carry the release ID compiled into the page. EventSource URLs retain this ID after reconnect. External requests keep their original headers.

The Neon adapter recognizes absent tables, columns, relationships, and functions. It preserves error codes for server callers. It logs diagnostic details and returns a safe message. It also clears cached schema metadata for the next API call.

The browser shows a notice and returns a 503 response for recognized schema errors. It does not reload the page or repeat the API call. Forms retain their error behavior. The browser regression verifies that the MCP form keeps its unsaved values. Earlier steps can already affect stored data. The notice makes no claim about which steps completed.

Trigger tasks stop automatic retries for recognized schema errors. After a repair, inspect earlier side effects before a task retry. No schema migration or automatic rollback runs in response to an error.

## Schema failure alerts

Schema failures emit a Sentry event tagged `failure_kind:schema_drift`. Events identify the database operation and table or function, SQLSTATE, release, and runtime. Worker events also include the task, run ID, and executing worker version. Worker commit metadata comes from Trigger's deployment context; synced Vercel variables may refer to a different release.

Diagnostic events exclude SQL, parameter values, request breadcrumbs, and task payloads. The error path waits up to two seconds for Sentry delivery. Delivery failures leave the safe database response and task retry decision intact. Without a Sentry DSN, structured server logs remain available.

The [Sentry rule configuration](./schema-drift-alert-rule.json) alerts on production schema events, including recurring unresolved incidents. It uses the project's issue owners with active members as fallback, and groups notifications per issue over five minutes. This notification interval does not delay application requests or tasks. The rule can be created through Sentry's project issue-rule API; Sentry also exposes equivalent monitors and alert workflows.

On an alert, compare the event's release and worker version with the deployed app, task deployment, and migration ledger. Check earlier writes before retrying. Repair forward with a compatible committed migration; do not automatically replay mutations or roll back a database migration.

To verify worker alert delivery after deployment, manually trigger `verify-schema-drift-alert` with an empty payload in the intended Trigger environment. It makes no database calls and intentionally fails once. Verify the Sentry event's `task_id`, `execution_runtime:trigger`, release, worker version, and run ID, then confirm the production alert fired. A failed run is the expected result of this check; it must not retry. This task is not scheduled.

This handles explicit schema failures, not every semantic change to stored data. Keep migrations compatible with both old and new app and worker releases. Add new fields first, migrate data, then remove old fields after those releases retire.
