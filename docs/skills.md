# Skills at run time

A skill is a written procedure a person keeps in their library
(`public.skills`): a name, a one-line description, and the instructions
themselves. This document covers how a skill reaches an agent. Editing skills
is ordinary CRUD under `app/api/skills/`.

## The catalog

`lib/skill-catalog/` is the single definition of which skills a run may draw
on. `loadSkillCatalog({ userId, repoId })` returns:

- the acting user's library,
- minus the skills the repo excludes (`repo_skill_overrides.excluded`),
- plus the skills the repo defines for itself (override rows with no
  `skill_id`), listed first.

Repo overrides apply only when the acting user owns the repo, the same rule
the repo settings panel enforces. Surfaces pass the repo id from the request,
so `loadSkillCatalog` is the gate: for anyone else the catalog is just their
own library.

Each catalog skill gets a **slug** from its name (`Deploy Checklist (v2)`
becomes `deploy-checklist-v2`). Slugs are assigned in catalog order, so a
repo's own skill takes the plain slug ahead of a library skill with the same
name, and within the library the oldest skill keeps it. Later collisions get
`-2`, `-3`. Slugs are derived, never stored: renaming a skill renames its
handle.

The catalog belongs to the person the run acts for. A shared roster agent
still carries the skills attached to it (`agent_skill_links`, see
AGENTS.md → Agents runtime); the catalog is what the *user* brings.

## Two ways a skill reaches an agent

**The user invokes it by name.** Two spellings work on every surface:

| Spelling | Where | Notes |
| --- | --- | --- |
| `/slug` | first word of the message | Reads like a command. A surface that owns the name (a CLI harness's `/compact`) keeps it. |
| `$slug` | anywhere in the message | Slack swallows a leading slash, so this is the spelling that survives there. |

A token counts only when the catalog has that slug, so `$HOME` and
`/unknown` stay ordinary text. Code spans and fenced blocks are skipped.
Underscores and case are forgiven (`$Deploy_Checklist`). In a conversation a
skill invoked in an earlier message stays in force for later turns.
`resolveInvokedSkills` (`invocations.ts`) is the only parser; do not write a
second one.

**The agent finds it.** Surfaces whose agent can load a skill get a one-line
index of the catalog in the prompt and two tools:

- `find_skills({ query?, limit? })` ranks the catalog by word overlap, name
  and tags weighted above the body (`search.ts`). No model call.
- `load_skill({ slug })` returns the full instructions.

Both live in `lib/agents/tools/skills.ts`, read the catalog once per run, and
sit behind the `tools.skills` capability, which every team role holds: they
read the acting user's own library and nothing else.

## Rendering

`renderSkillCatalog` (`render.ts`) builds one `<skills>` block:

- `## Invoked skills` carries the full text inline, or lists file paths when
  the surface has a checkout (`.mogplex/skills/<slug>/SKILL.md`).
- `## Available skills` is the index. It is omitted when the agent has no way
  to load a skill, because a list the agent cannot act on is noise.

Budgets: 32,000 characters of inlined skill text per prompt and 60 index
lines. Past the index cap the block points the agent at `find_skills`.

## Rules for new surfaces

- Skills add to a request. A catalog that fails to load never blocks a run:
  use `loadSkillCatalogOrEmpty` or `resolveConversationSkills`, both of which
  swallow and log.
- Never rewrite the user's message. The invocation token stays in the
  transcript exactly as typed; the skill text travels in the system prompt or
  a prompt preamble.
- Conversational surfaces go through `createChatModelStream`
  (`lib/agents/run-chat.ts`), which already resolves skills for workspace
  chat, Slack conversations, and native agent runs.
- Control builds its own prompt. `loadControlKnowledgeContext`
  (`app/api/control/chat/_lib/knowledge-context.ts`) loads skills beside the
  memory block, the orchestrator prompt renders them in `<skills>` right
  after `<memory>`, and `find_skills` / `load_skill` are registered as
  read-access orchestrator tools, so plan mode keeps them.
- CLI harness runs (`app/api/sandbox/[id]/harness/_lib/skill-catalog.ts`)
  write skills as files and name them in a block between the agent block and
  the task. That one route serves the workspace harness pane, the v1 runs API,
  MCP `mogplex_start_agent_run`, Slack repo-agent runs, Control's
  `spawn_subagent`, and the roster's Run button, so a `$slug` in any of those
  prompts works. The harness's own slash commands are reserved: `/compact`
  stays the CLI's even when a skill is named Compact. Skills already attached
  to the run's roster agent are left out of the index, and native runs pass
  `attachedSkillIds` to `createChatModelStream` for the same reason.
- Automation agent nodes (`lib/workflows/automation-job-skills.ts`). The
  node's instructions are where its author speaks, so a `$slug` written there
  invokes a skill. So does a comment that @mentions Mogplex and the prompt of
  a signed webhook. Other payload text (PR bodies, diffs, third-party
  comments) is task data and never invokes anything. A native node gets the
  block in its instructions plus `find_skills` / `load_skill`; a CLI harness
  node goes through the harness route above. Either way the node also gets
  the rules and skills attached to its roster agent, which flow nodes used to
  drop. The PR fixer that follows a review is the node's agent too and gets
  the same block on both paths. The acting user is the repo owner, the same
  identity the harness route acts for.

## API and MCP

External agents reach the same catalog through the v1 API, read scope:

- `GET /api/v1/mogplex/skills?q=&repoId=&limit=` returns summaries and the
  catalog size. MCP: `mogplex_list_skills`.
- `GET /api/v1/mogplex/skills/{slug}?repoId=` returns one skill with its
  instructions. MCP: `mogplex_get_skill`.

`repoId` must be a repo the caller owns for its overrides to apply; any other
id quietly yields the caller's plain library. A client that starts a run does
not need to fetch the text: writing `$slug` in the prompt of
`mogplex_start_agent_run` is enough.

## In the UI

`GET /api/skills/catalog?repoId=` returns the signed-in user's handles without
instructions (`hooks/use-skill-catalog.ts`). It backs three things:

- The workspace composer lists skills in its `/` menu. A skill is a slash
  command whose `skill` action means "send as typed"; before that existed,
  `/slug` was dropped as an unknown command.
- Both Control composers complete `/slug` as the first word and `$slug`
  anywhere (`components/control/skill-suggestions.tsx`, rules in
  `lib/skill-catalog/suggest.ts`).
- The installed skills list shows each skill's `$slug`.

Completion is a convenience. The server resolves a handle whether or not the
menu ever opened.

## Usage counts

`skills.usage_count` goes up by one each time a library skill reaches a run:
the turn a user invokes it, or the moment an agent calls `load_skill`.
Finding a skill does not count, and a skill invoked on turn one is not counted
again on turn two. `recordSkillUse` (`usage.ts`) calls the
`increment_skill_usage` SQL function, which is scoped to the owner, and
swallows every error: a count never delays or fails the run it describes.
Repo-defined skills have no counter.

## Observation

The decision layer's `skill_selection` check (docs/decisions.md) judges the
skills in play for a run: the roster agent's attached skills and the user's
catalog, in one call. It is `shadow`: it records which skills the request
needed and changes nothing. The point is evidence. If the agent keeps loading
the skill the check would have picked, loading it up front can be promoted
with numbers behind it.

Every call site starts the check beside the work and keeps it alive without
waiting on it: the harness route and workspace chat hand it to `after()`,
the native runner awaits it in `finally`, and Control awaits it when the turn
ends. `createChatModelStream` reports the resolved skills through
`onSkillsResolved`. Slack conversations are not observed yet.

## Registry installs

A skill installed from skills.sh gets its instructions from the SKILL.md in
the skill's source repository (`lib/skills-registry/skill-md.ts`), not from
the listing page. Skills installed before 2026-09-21 hold an install command
or a stub instead; reinstalling replaces it.

## Known gaps

- The CLI (`Mogplex/cli`) has its own local skills system and does not read
  the account library. The v1 skills API is what it would sync from.
- Slack conversations resolve and deliver skills but are not yet covered by
  the `skill_selection` observation.
- Skill files written into a sandbox are not removed when the skill is
  deleted from the library. The prompt only names current skills, so a stale
  file is unreachable rather than wrong.
