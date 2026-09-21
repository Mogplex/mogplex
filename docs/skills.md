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
