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
in that thread. Replies stream into the thread as the agent writes them, with
each tool step (checking GitHub, reading a file) shown as a task card. If Slack
does not accept a streamed reply, Mogplex edits a single message instead; set
`SLACK_STREAMING_REPLIES=off` to always do that. Each new DM root starts its own conversation; replies use that
root's conversation and history.

A finished run's card is short: the outcome, an excerpt of the agent's report,
what changed, where it landed, and one line on recorded checks. **Details**
opens the full report, the recorded checks with their caveats, the workspace
state, and guidance receipts. Anyone in the conversation can open Details,
the same people who can read the card.

Run cards show what changed without leaving Slack. While a run works, **Changes
so far** opens a modal with the diff from the live workspace, including
uncommitted work. When it finishes, the result card lists the files changed on
the pushed branch, with line counts, and **View changes** opens the same modal.
A stopped workspace is never resumed to read changes; the pushed branch is used
instead. Only the person who started the run sees the diff. Anyone else is
pointed to the pull request, where GitHub enforces repository access. Secrets
are redacted from diffs, and large change sets show the first files with a link
to the full comparison on GitHub.

Runs can pause in the thread for your answer instead of finishing on their own:

- **Plan first.** Ask for a plan ("plan it first", "show me the approach") and
  the run proposes one without changing any file. **Approve plan** starts the
  work; **Revise plan** (or any thread reply) sends feedback, and the agent
  comes back with a revised plan.
- **Review.** When the work reaches a checkpoint, **Ship it** opens the pull
  request, **Request changes** (or a thread reply) sends the agent back to
  work, and **View changes** shows the diff.

Only the person who started the run can answer it. Each pause takes one answer:
the first button press or reply resumes the run, and the buttons are replaced
with who answered and how.

[Slack does not support custom slash commands inside message threads](https://docs.slack.dev/interactivity/implementing-slash-commands/).
Use the main composer for slash commands. Inside a thread, send `mogplex-cancel`
as a plain reply (no slash). This immediately cancels your run in that exact
thread, before any agent or workflow dispatch, without a confirmation prompt.
It never falls back to another thread's run. You can append a run ID if several
active runs share the thread. Control messages bypass the normal conversation
queue so cancellation does not wait for the current turn to finish.
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
