# Agent merge controls

Owners and admins can change these controls in **Team settings > Members > Agent merges**. Both controls are off by default.

- **Require merge approval:** Each request binds the acting user, team, repository, pull request number, head SHA, and commit title. The user approves or denies their own request in settings. Approval permits one direct merge attempt. A failed attempt consumes approval, so another attempt needs a new request.
- **Merge only in the run's repository:** Refuse a different target repository or a run without repository context.

These controls cover Mogplex's merge tools in chat, Slack conversations, CLI MCP runs, native flow reviewers, and post-run flow merge actions. Every execution reads the current team policy and checks membership. Cached tool discovery does not cache permission to merge. Personal runs keep their existing behavior.

With approval on, Mogplex does not enable GitHub auto-merge. That operation can remain armed after a writer pushes a different head. A direct merge pins the approved SHA and still respects GitHub's checks and protection rules. Queue-only tools return instructions to use a direct merge. See [GitHub's auto-merge behavior](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/automatically-merging-a-pull-request).

Select **Refresh requests** to see pending requests. Approval does not restart or replay a run. Ask the agent to continue, or start a new run against the same target. There is no approval polling.

When approval is on, native flow reviewers defer the merge until their review check is complete. The finalizer then requests approval or uses an approved request. A new review cannot consume that approval before its check completes.

The `tools.github_merge` capability is separate from `tools.github_api`. Developer presets retain both capabilities. A grant of GitHub inventory or editing tools alone does not grant Mogplex merge tools.

Team merge attempts include the approval ID in the team audit log. Personal attempts use the structured log and the run's tool-call record. These controls do not govern manual GitHub merges or arbitrary commands with separately supplied credentials.
