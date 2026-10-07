# PR review recovery

Native PR reviews save each completed model step. Use **Retry** on a failed run
in Mogplex to continue from the last saved step. This applies to reviews started
after the checkpoint migration and its worker release.

Recovery needs the same owner, repository, PR head and base commits, node,
flow version, model, instructions, and prompt. A changed setup starts fresh and
keeps the old checkpoint. A changed live PR blocks reuse of stale evidence.
A completed draft can proceed to final report checks without another review.

Each provider request retains its timeout and step retry. The native
PR review loop has no total 25-minute deadline. The automation task uses
Trigger's `timeout.None`. Other generation phases retain their current budgets.
Trigger retries remain disabled to prevent duplicate external actions.

The server awaits each checkpoint write before the next model call. A failed
write aborts the generation explicitly because AI SDK v7 swallows errors from
lifecycle callbacks.

The checkpoint includes the transcript, completed tool calls and results, and
any structured findings. It does not include the GitHub access token or transport
headers. Usage records count only new model calls on each retry.

An external action gets a durable marker before execution. The marker includes
its tool name, call ID, and input. Concurrent actions retain all their markers.
If the worker stops before Mogplex saves their results, Retry stops for manual
reconciliation. Completed review evidence remains stored.

An operator must locate the checkpoint by `job_run_id`, `node_id`, and `user_id`.
Inspect each `inFlightTools` entry and confirm its outcome in GitHub. Do not clear
markers or delete the checkpoint: that would allow replay without a saved result.
After resolving the actions, start a separate review with
[`mogplex_trigger_automation`](./mogplex-api-mcp/local-agent-automation.md), using
the current PR head/base and the same automation and repository. This starts a
fresh run instead of retrying the blocked step; the old evidence stays stored.

A clean saved verdict still requests flow auto-merge when the node enables it.
`executeAutomationContext` rebuilds that request after the reviewer returns.
The flow checks the current merge policy and exact head after publishing its review.

Checkpoints are server-only rows in `pr_review_checkpoints`. They have no timed
expiry. Deletion of the parent job or account deletes its checkpoint.

Older runs without a checkpoint need a fresh review. Usage totals cannot restore their
transcripts. A provider response interrupted before a step finishes is not a
completed checkpoint.

The migration is additive. Apply it through the production deployment workflow
before the worker from the same release serves new runs. Older workers can
continue to use the prior schema, but they do not save or resume checkpoints.
