# Dependabot remediation

Mogplex can prepare a dependency fix for review when GitHub creates an alert.
GitHub continues to detect vulnerable dependencies. A Mogplex PR does not close the alert.

## Activate the GitHub App

These settings belong to GitHub. A Mogplex deployment does not change them.

1. Open **Developer settings → GitHub Apps → the app → Permissions & events**.
2. Set **Dependabot alerts** to **Read-only** (`vulnerability_alerts: read`).
3. Keep **Contents** and **Pull requests** at **Read and write**. Keep **Metadata** at **Read-only**.
4. Subscribe to **Dependabot alert** (`dependabot_alert`). Keep the app's other event subscriptions.
5. Set the webhook URL to `https://<your-domain>/api/webhooks/github`.
6. Set the webhook secret to the same value as `GITHUB_WEBHOOK_SECRET`.
7. Accept new permissions for each installation. Confirm that the installation can access each target repository.
8. Keep Dependabot alerts enabled for each target repository.
9. Create a workflow with the **Dependabot autopilot** template. Select its installation, repository scope, agent, and model, then publish it.
10. Test a `dependabot_alert.created` delivery in the app's **Advanced → Recent deliveries** view. Confirm one run in Mogplex.
11. Redeliver the same delivery. Confirm that Mogplex does not create another run.

To make Mogplex the only remediation PR creator, turn off **Dependabot security updates** for the selected repositories after verification.
Keep **Dependabot alerts** on. Review any `.github/dependabot.yml` version-update policy separately.
This feature does not change those settings or disable GitHub detection.

The repository has no GitHub App creation manifest. Apply these settings to the app before activation.
GitHub documents the [webhook event](https://docs.github.com/en/webhooks/webhook-events-and-payloads#dependabot_alert)
and [alert API permissions](https://docs.github.com/en/rest/dependabot/alerts#get-a-dependabot-alert).

## Choose events

The start node offers six actions: `created`, `dismissed`, `fixed`, `reopened`, `reintroduced`, and `auto_dismissed`.
The template selects only `created`. An omitted action list also means `created`. An empty list matches nothing.
The parser accepts `auto_dismissed` for compatibility if GitHub sends it.

Other actions need explicit selection. They report the canonical alert state and preserve dismissal context.
They do not start remediation, cancel another run, close a PR, or dismiss an alert.
For external harnesses, Mogplex records the canonical lifecycle result and skips code execution.
Reopened and reintroduced alerts need a deliberate follow-up decision. They do not restart a created-only flow.

Each selected event uses flow and job records. Metadata includes repository and installation identity, alert details, and dismissal context.
GitHub delivery IDs retain their deduplication behavior. Each delivery can start each workflow that matches once.
Lifecycle deliveries create separate records. They do not rewrite earlier runs.

Saved workflows retain their published graphs. The new template applies when users create a workflow from it.

## Review the result

The agent first reads the canonical alert from GitHub. A closed alert needs no edit.
A denied or failed lookup stops execution. No patched version needs a human decision.

The native Mogplex agent uses a persistent checkout on a dedicated branch.
It rechecks the alert before each command. External harnesses check the alert before launch and must reconfirm it before edits.
The agent must check open PRs, then use the repository's native package manager for the smallest manifest and lockfile update.

Major upgrades, unsafe indirect dependency changes, and failed checks need a clear report and a human decision.
The agent must not force these changes or merge a PR.
These upgrade and validation policies are agent instructions. They are not a package-resolution engine.

Run the repository's available install/integrity, lint, typecheck, test, and build checks.
The PR must list the alert, GHSA and CVE, severity, package, old and new versions, and validation results.
Report unavailable commands and failed checks accurately.

“PR opened” means a proposed fix exists. GitHub decides when the default branch no longer contains the vulnerable dependency.
Never dismiss an alert merely because a PR exists. See GitHub's [alert resolution guidance](https://docs.github.com/en/code-security/how-tos/manage-security-alerts/manage-dependabot-alerts/view-dependabot-alerts).
