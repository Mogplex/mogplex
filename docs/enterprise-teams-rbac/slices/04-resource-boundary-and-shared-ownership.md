# Slice 04: Resource Boundary and Shared Ownership

Status: Proposed

## Owner

Resource ownership agent.

## Goal

Make teams real resource boundaries instead of only applying policy to personal resources.

## Write Scope

- Migrations adding team ownership metadata to shared resources.
- Resource auth helpers such as `lib/resource-owner.ts` or feature-local equivalents.
- Repo/workspace/conversation/connection/sandbox read helpers touched by the new ownership contract.
- Focused route tests for representative resource reads and writes.

Do not migrate all existing personal data into teams automatically.

## Ownership Contract

Every team-shareable resource needs both resource ownership and actor identity:

```ts
type ResourceOwner =
  | { ownerType: "user"; ownerUserId: string; productTeamId: null }
  | { ownerType: "team"; ownerUserId: null; productTeamId: string };
```

Add team ownership in the smallest safe migration path:

- `repos`: `owner_type`, `owner_user_id`, `product_team_id`, `created_by_user_id`.
- `workspaces`: same ownership columns.
- `connections`: same ownership columns, with team-owned connections gated by `connections.create`.
- `conversations`, `ai_calls`, `job_runs`, `sandboxes`, and `memories`: record `product_team_id` and `actor_user_id` at creation time where they can be team-scoped.

Keep existing `user_id` columns for backward compatibility until a later cleanup. New queries must use owner helpers rather than raw `eq("user_id", userId)` when a route can be team-aware.

## Access Rules

- Personal resources are visible only to their owner.
- Team resources are visible to current team members.
- Mutating team resources requires the relevant capability.
- Execution records must store `actor_user_id` even when the resource is team-owned.
- Existing personal rows remain personal unless explicitly moved by an owner/admin flow.

## Migration Rules

- Backfill existing rows as `owner_type = "user"` and `owner_user_id = user_id`.
- Add indexes for `(owner_type, owner_user_id)` and `(product_team_id)` on team-aware tables.
- Do not drop existing owner-scoped RLS policies until route helpers are converted and tested.

## Acceptance Criteria

- A team-owned repo can be read by another member of the same team.
- A non-member cannot read the team-owned repo.
- Personal repo visibility is unchanged.
- New team-scoped runs/sandboxes/ai calls persist both `product_team_id` and `actor_user_id`.
- Queries that still use `eq("user_id", userId)` are inventoried and classified as personal-only or follow-up.

## Tests

- Unit: resource owner helper permits owner, permits team member, denies non-member.
- Route tests: list repos in personal mode, list repos in team mode, deny non-member team access.
- Unit: execution record builders persist team id and actor user id.
- Migration review for indexes and backfill.

## Handoff

Model, tool, sandbox, audit, and UI slices must use resource-owner helpers so they do not accidentally gate only personal records.
