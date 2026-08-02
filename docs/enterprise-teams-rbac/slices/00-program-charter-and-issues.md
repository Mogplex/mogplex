# Slice 00: Program Charter and Issue Breakdown

Status: Proposed

## Owner

Program/spec agent.

## Goal

Establish the teams/RBAC program as a durable repo source of truth and prepare child issues for independent implementation sessions.

This slice does not change runtime behavior.

## Write Scope

- `docs/enterprise-teams-rbac/**`
- GitHub child issues linked to issue #431, only after explicit user approval because issue creation is externally visible.

Do not edit auth, database migrations, settings UI, model routing, or tool runtime code in this slice.

## Required Decisions

- Teams are called `teams` in the product and database.
- Existing `workspaces` stay as personal repo grouping.
- Supabase Auth remains active for implementation slices 1 through 7.
- Nullable WorkOS IDs are included from the first schema slice.
- Each later slice maps to one PR and has its own acceptance criteria.

## Child Issues To Create

Create one issue per implementation slice with this naming pattern:

```txt
[Enterprise RBAC] Slice NN: <slice title>
```

Each issue body must include:

- Link to this program README.
- Link to the exact slice spec.
- Goal.
- Write scope.
- Acceptance criteria.
- Required tests.
- Dependency on previous slices.

## Acceptance Criteria

- Program README and all slice specs are committed.
- Issue #431 remains the parent epic.
- Child issues, if created, each link to #431 and their slice file.
- No runtime files are modified.

## Tests

- `git diff --check`
- Markdown link/manual review for every slice path.

## Handoff

Slice 01 can begin once this document and the overview are merged.
