# Slack commands and replies

Run `/mogplex help` (or `/mogplex` with no arguments) to see commands. Help
responds immediately and does not require linking your Mogplex account.

| Command | Action |
| --- | --- |
| `/mogplex status` | Show your latest Slack run |
| `/mogplex-cancel [run-id]` | Cancel your active run in this channel |
| `/mogplex cancel [run-id]` | Same cancellation through the existing slash command |
| `/mogplex repo [owner/repo]` | Show or choose the channel repository |
| `/mogplex prs` | Browse open pull requests |
| `/mogplex issues [create]` | Browse issues or open the issue creation form |
| `/mogplex usage` | Show inference credit |
| `/mogplex model [model-id]` | Show or choose your model |
| `/mogplex harness [mogplex\|codex\|claude-code]` | Show or choose your runner |
| `/mogplex agent [slug]` | Show or choose a roster agent |

Cancellation uses the linked caller's runs in the current workspace and channel.
With one active run it cancels immediately. With several it lists IDs so you can
choose one. An explicit ID is checked against the same scope. Completed runs are
reported as finished; paused runs can be cancelled without discarding their saved
workspace or rewriting the completed harness pass.

DM questions and channel mentions receive replies under the original question.
Follow-ups, progress cards, failures, account-link notices, and run results stay
in that thread. Each new DM root starts its own conversation; replies use that
root's conversation and history.

[Slack does not support custom slash commands inside message threads](https://docs.slack.dev/interactivity/implementing-slash-commands/).
Use the main composer for slash commands and the run's Cancel button in a thread.
Command responses are private to the caller.

## App registration

Code deployment does not register new top-level commands with Slack. In the
existing Mogplex app's **Slash Commands** settings, preserve existing commands
and register:

| Field | Value |
| --- | --- |
| Command | `/mogplex-cancel` |
| Request URL | `https://mogplex.com/api/webhooks/slack` |
| Short description | `Cancel your active Mogplex run in this channel` |
| Usage hint | `[run-id]` |

Keep `/mogplex` pointed at the same request URL, with usage hint
`help | status | cancel | repo | prs | issues | usage | model | harness | agent`.
These commands reuse the existing `commands` scope. Deploy the app and matching
Trigger worker before registering the alias. `/mogplex cancel` requires no new
command registration.
