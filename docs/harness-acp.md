# Sandbox harnesses over the Agent Client Protocol

Codex sandbox runs go through the [Agent Client Protocol](https://agentclientprotocol.com/)
instead of a one-shot `codex exec --json` invocation. A harness opts in with an
`acp` pin in `lib/harness/config.ts`; today only Codex has one
(`@agentclientprotocol/codex-acp`, which bundles its own `@openai/codex`).
Claude Code still runs through its CLI.

## How a run works

`runHarness` (`lib/harness/runner.ts`) installs the pinned ACP agent, writes two
files under `/vercel/sandbox/.mogplex/` (ignored by git sync, refused by
delivery), and launches `node .mogplex/acp-bridge.mjs <run file>` under the same
`setpriv` isolation the CLI gets.

- `lib/harness/acp/bridge-script.ts` is the in-sandbox ACP client. It starts the
  agent over stdio, signs it in, opens or resumes a session, sends the prompt,
  answers permission requests, and prints every event on stdout as one JSON
  line tagged `mogplex_acp`. It deletes the run file (which holds the prompt)
  once read, and waits for the agent to shut down before exiting.
- `lib/harness/acp/renderer.ts` turns those lines into the same text and
  tool-call segments the CLI renderers produce. `createHarnessOutputRenderer`
  picks the renderer from the first stdout line, so the agent pane,
  automations, and the runs API read both formats without knowing which
  protocol a run used.
- `lib/harness/session-parser.ts` takes the resume id from the bridge's
  `session` event. A resume the agent cannot honor falls back to a fresh
  session inside the bridge, with a status line in the transcript.

## What ACP changes for Codex

- **MCP servers.** Codex gets the user's runnable connections and the
  `mogplex` server (the native agent's own tools) from `.mogplex/mcp.json`, the
  same file Claude Code reads, passed in `session/new`. Before ACP it got only
  web research.
- **Approvals.** Workers have nobody to ask, so the bridge decides every
  `session/request_permission` by run mode (`acpPermissionPolicy`). MCP tools
  are approved: ask-mode connections never reach a harness. Other requests are
  approved in YOLO and declined otherwise, and each decision appears in the
  transcript as a tool call marked denied. When Codex offers no way to decline
  that keeps the turn going, the bridge picks its "tell Codex what to do
  differently" option and sends the decline as the next message, so the run
  continues the way `approval_policy="never"` did.
- **Modes.** SAFE, AUTO, and YOLO map to codex-acp's `read-only`,
  `workspace-write`, and `agent-full-access` modes. SAFE keeps the harness from
  changing the checkout itself; it does not screen MCP tools, which run in
  every mode for Codex and Claude Code alike. A connection or Mogplex tool that
  writes (a GitHub issue, a memory, a stdio server with filesystem access) can
  still change things in SAFE.

## Credentials

The bridge signs Codex in with codex-acp's `gateway` method, which configures
the model endpoint in the agent's memory: the Mogplex AI Gateway's Codex
endpoint for gateway-billed runs, or OpenAI (or the user's `OPENAI_BASE_URL`)
for a direct key. Do not switch to the `api-key` method: it writes the key to
`~/.codex/auth.json` in a sandbox the user can open. The bridge reads the key
from `CODEX_API_KEY` and removes it from the agent's environment, so neither
Codex nor the commands it runs hold it.

## Operating it

- `MOGPLEX_HARNESS_ACP=off` (Vercel and Trigger environments) returns every
  harness to its CLI invocation without a code change.
- `pnpm harness:smoke` runs one bridge turn against the pinned ACP agent when
  `CODEX_API_KEY` is set, and the pin-sync workflow keeps the ACP pin current
  alongside the CLI pins.
