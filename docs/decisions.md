# Decision layer

The agent runtime makes many small judgments per run: is this shell command
dangerous, did that command really succeed, does the final message match what
the tools did. `lib/decisions/` answers those with an evaluation model that
returns typed answers and probabilities instead of text, in a few hundred
milliseconds, through the same AI Gateway credential the rest of the platform
uses. Language models keep writing code and prose. The decision layer judges.
Code acts.

## Decisions

| Id | Where it runs | Default mode | What acting means |
| --- | --- | --- | --- |
| `command_risk` | Control `run_command`, via the policy wrapper | `enforce` | A remote-destructive command (force push, remote deletion, dropping data) pauses for operator approval |
| `command_risk` | Native `bash` tool on chat, Slack, and API runs | `shadow` | In `enforce`, the command is not run and the agent is told why. No approval path exists on these surfaces, so it observes by default |
| `tool_result_failed` | Every shell result with exit code 0 and output | `advise` | The result gains an `outputCheck` note when a step failed behind `set +e`, `\|\| true`, or a pipe |
| `claim_verification` | End of every Control, chat, Slack, and API turn (awaited, so a worker that exits with the turn cannot drop it) | `advise` | An unsupported "tests pass", "PR opened", or "pushed" claim becomes a notice in the run's activity |
| `loop_check` | In the background once a turn has six tool calls | `shadow` | Records only. By policy nothing may end or shorten a run |
| `memory_promotion_gate` | Before memory promotion's extraction call | `shadow` | In `enforce`, skips extraction when the record holds nothing durable |
| `skill_selection` | When a roster agent with linked skills starts a run: the sandbox harness route (`harness`) and the native runner (`agent_run`) | `shadow` | Records only. Every linked skill is still loaded; the row says which ones the task needed |
| `memory_relevance` | Every Control turn that injects memories, beside the turn | `shadow` | Records only. The prompt is already built; the row says which injected memories bear on the request |
| `flow_classify` | Every automation Classify node | always acts | The run takes the answered branch. The question is authored in the flow graph |

Questions, thresholds, and versions for the runtime's own decisions live in
`lib/decisions/definitions.ts` and, for the per-candidate decisions,
`lib/decisions/definitions-selection.ts`, and nowhere else. The one exception is
`flow_classify`: its question belongs to the customer's flow, so it is stored
with each event instead (`question_version` is `authored`). The evaluation
model answers the question as written, so keep wording literal, positive, and
atomic, and bump `version` on every change.

### Per-candidate decisions

`skill_selection` and `memory_relevance` judge a list that is only known at
call time. The caller labels each candidate with a short key (`c01`, `c02`,
...), puts the labelled content in the state, and passes the keys as
`candidates`; `decide()` builds one yes/no question per key from the
definition's `candidateQuestion`. One call returns a probability per
candidate, and the state is billed once, not once per question. A call judges
at most 48 candidates and records how many it left out as `metadata.omitted`.
Ids never enter the judged state: `metadata.candidates` maps each key back to
the skill or memory id.

Both are `shadow` and their thresholds (`SKILL_NEEDED_THRESHOLD`,
`MEMORY_RELEVANT_THRESHOLD`) are first guesses with no production data behind
them. Promote neither until the recorded probabilities have been reviewed.
Rules are out of scope by design: an agent's rules always apply.

## Modes

`off`, `shadow` (evaluate and record), `advise` (also surface a note), and
`enforce` (also change control flow). Override per decision or per surface:

```bash
DECISION_MODES='{"command_risk.agent_tool":"enforce","loop_check":"off"}'
DECISIONS_DISABLED=1            # kill switch
DECISION_MODEL=typesafe-ai/jev  # evaluation model on the gateway
DECISION_ESCALATION_MODEL=anthropic/claude-sonnet-5
```

An installation without `AI_GATEWAY_API_KEY` (or Vercel OIDC) runs with the
layer silently inactive.

## The account's switch

The whole layer is a choice each account makes. `teams.decision_checks_enabled`
governs all work inside a team, and `profiles.decision_checks_enabled` governs
a person's work outside one. Both default to on. A team owner or admin changes
the team's value under Settings, Models, "Run checks" (`PATCH
/api/teams/:teamId/decision-checks`), which writes a
`decision_checks.changed` audit event. A person changes their own under
Settings, Account (`PATCH /api/settings/decision-checks`).

- **It outranks every mode.** `decide()` and `classify()` are the only two
  paths to the evaluation model, and both ask
  `lib/decisions/account-setting.ts` before any state is built. For an account
  that is off nothing is evaluated, nothing is sent, and no `decision_events`
  row is written.
- **The team decides for team work.** A member's own setting is never
  consulted for work that carries a team id, so every call site must put the
  team id in its `DecisionScope`.
- **Off removes the command-risk approval.** That gate is the same model call,
  so the Settings copy says so. `policy.ts` and the shell guard are untouched.
- **Classify fails, visibly.** A Classify node in an account that is off fails
  with a message that names the setting, for the flow's `error` handle to
  route. It never picks a branch.
- **A failed or slow read means off.** The read is bounded at 2 s. Skipping a
  check costs what an evaluator outage already costs, and sending an opted-out
  account's data cannot be taken back. Failures are not cached.
- **Changes land within 30 s.** Each process caches a loaded choice for
  30 s. The process that handles the change drops its own entry at once.

## Rules

- **Fail open.** `decide()` never throws. On a timeout, an outage, or an open
  circuit breaker the caller behaves exactly as it did before the layer
  existed.
- **Authored decisions do not fail open.** `classify()` backs the automation
  Classify node. The author chose that node to pick a branch, so an outage is
  returned as a failure for the flow's `error` handle to route. It has no
  second opinion and no mode: `DECISIONS_DISABLED=1`, or an account that
  turned its checks off, makes it fail, not pass.
- **Only add caution.** A decision can add an approval or a note. It can never
  relax `policy.ts`, a protected-branch rule, or the shell guard.
- **Never end a run.** The agent execution policy forbids iteration budgets.
  `loop_check` records what it sees and nothing more.
- **Second opinion on the uncertain band.** When a definition sets `escalate`
  and the answer falls in its middle band, the same questions go to a language
  model and its answer decides. That call has its own budget
  (`escalationTimeoutMs`), 8 s by default, because both gated call sites wait on it. On real traffic this matched the language
  model's accuracy at about one eighth of the cost.
- **Only a mode that can act may wait.** A judgment that can change what
  happens runs first. One that only observes runs alongside the work and is
  awaited before the tool call or turn returns, so it costs no wait up front
  and is not lost when a worker exits with the turn.
- **No provider names in anything a customer reads.** Notes and approval
  summaries describe the finding, not the machinery.

## Logging

Every decision writes one `decision_events` row: the redacted state that was
judged, the questions and their version, answers, probabilities, confidence,
latency, tokens, cost, any second opinion, the baseline (what the system did
without the decision), and whether the runtime acted. The state is stored on
purpose. Run telemetry omits most tool inputs and outputs, so without it a
decision could not be audited or re-scored. Secrets are redacted with the
telemetry sanitizer before state leaves the process, and state is capped at
60k characters. Each decision also emits a `[decisions]` structured log line.
When the gateway reports a generation id it is stored as
`metadata.generation_id`, so a call can be reconciled against gateway cost
records later. Classify events also carry the flow, version, run, and node ids.

Useful queries:

```sql
-- How often would the shadow gate have blocked, by surface?
select surface, verdict, count(*) from decision_events
where decision_id = 'command_risk' group by 1, 2 order by 3 desc;

-- What a flow's Classify nodes answered, and how sure they were.
select metadata->>'flow_node_label' as node, verdict, count(*),
       round(avg((confidence->>'answer')::numeric), 2) as avg_confidence
from decision_events where decision_id = 'flow_classify'
  and metadata->>'flow_id' = '<flow id>' group by 1, 2 order by 3 desc;

-- How many injected memories the relevance filter would have dropped, per turn.
select created_at, (baseline->>'injected')::int as injected,
       (select count(*) from jsonb_each(answers) a
        where (a.value->>'probability')::numeric < 0.2) as would_drop
from decision_events where decision_id = 'memory_relevance' and status = 'ok'
order by created_at desc;

-- Frontier calls the promotion gate would save.
select verdict, (baseline->>'promoted')::int > 0 as promoted, count(*)
from decision_events where decision_id = 'memory_promotion_gate' group by 1, 2;
```

## Evidence behind the defaults

Replay of 176 real shell calls against exit codes (2026-09-19): evaluation
model 88.6% accurate alone at ~270 ms and ~1/80 the cost of the language
model; with the second-opinion band, 95.5%, identical to the language model
alone. A 50-command red-team set for `command_risk`: 49/50 exact, and at the
0.7 act threshold 20/20 destructive commands caught with 0/30 false alarms,
including misleading comments, `git push -uf`, and `+HEAD:main`.
