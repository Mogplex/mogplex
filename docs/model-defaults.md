# Choosing where a default model applies

In **Models → Configuration**, choosing a default opens a confirmation dialog.
All destination switches start off. Cancel leaves the default and every
destination unchanged. Confirm sets the default for new automation nodes and
applies it only to the additional destinations you selected:

- **Automations:** each automation has its own switch. Selecting it updates
  primary agent models in its draft and, when published, creates a new
  published version using the new model. Unpublished draft edits are not
  published. Fallback models, schedules, and activation status stay in place.
- **Web chat, Slack agent, CLI, and Control:** each keeps an independent
  default for requests or new sessions without an explicit model selection.
  Existing conversations, Slack channel preferences, and CLI model arguments
  remain explicit choices.
- **Agent presets and API / MCP:** updates the default used for preset agents
  and new agent creation. Saved agents keep their configured models.

Unchecked surfaces keep their current defaults across subsequent account
default changes. Model availability, provider access, and workspace policy
continue to apply to every request.

The settings update and selected automation publications are one transaction.
A failure leaves all destinations unchanged so the selection can be retried.
Only automations owned by the signed-in user are listed and eligible.

## Storage and deployment

`profiles.surface_models` stores independent defaults. Existing profiles with
an empty map inherit the account default until their first default change.
The `apply_model_defaults` RPC captures unchecked defaults while changing the
account default and publishing selected automation models atomically. It is
restricted to the service role; the API authenticates the actor, validates
destinations, and checks account model access. Automations are user-owned;
repository-specific team policy is resolved and enforced when they run.

The matching Neon and Supabase migrations are additive and run through the
production deployment workflow before the new application and worker code.
