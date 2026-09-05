# Slack harness selection

`/harness` shows your current repository runner. Choose with `/harness mogplex`,
`/harness codex`, or `/harness claude-code`. `/mogplex harness` supports the same
arguments using the existing Mogplex slash command.

Selections belong to the authenticated Slack user in the current channel and
installation. They apply to future repository runs only, not conversational
replies or existing runs. The default is `mogplex`. CLI runners retain their
existing credential requirements. Selecting a runner does not configure credentials.

## Deployment and Slack registration

Apply the mirrored `20260905002500_slack_harness_preferences.sql` migration using
the normal schema-first deployment before deploying the web app and Trigger worker.

In the existing Mogplex app's Slack configuration, add a slash command:

- Command: `/harness`
- Request URL: `https://mogplex.com/api/webhooks/slack`
- Short description: `View or choose your repository runner`
- Usage hint: `[mogplex|codex|claude-code]`

Keep existing slash commands and scopes. Use the existing `commands` bot scope.
Follow any reinstall prompt Slack presents. Registration is separate from code
deployment; `/mogplex harness` works without registering a new top-level command.
See [Slack's command setup guide](https://docs.slack.dev/interactivity/implementing-slash-commands/).

Verify with a linked account: show the default, select another harness, submit a
repository task, and confirm the run's `harness_id`. Verify another user/channel
does not inherit that selection. An unlinked account must not be able to change it.
