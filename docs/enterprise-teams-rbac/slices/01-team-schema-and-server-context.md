# Slice 01: Team Schema and Server Context

Status: Proposed

## Owner

Schema and server-context agent.

## Goal

Add local Mogplex team primitives and server helpers for resolving active team context. This establishes the durable identity layer for later capability, UI, and audit work.

## Write Scope

- `supabase/migrations/*_enterprise_teams.sql`
- `lib/team-context.ts`
- `lib/team-feature-gate.ts`
- `tests/unit/team-context.test.ts`
- `tests/unit/team-feature-gate.test.ts`
- Type additions in `lib/types.ts` only if needed by route contracts

Do not edit model resolution, tool filtering, settings UI, or sandbox launch behavior in this slice.

## Data Model

Add `public.teams`:

- `id uuid primary key default gen_random_uuid()`
- `name text not null`
- `owner_user_id uuid not null references public.profiles(id) on delete restrict`
- `plan text not null default 'enterprise_pending'`
- `status text not null default 'active'`
- `billing_vercel_team_id text null`
- `billing_vercel_project_id text null`
- `workos_organization_id text null unique`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Add `public.team_members`:

- `id uuid primary key default gen_random_uuid()`
- `team_id uuid not null references public.teams(id) on delete cascade`
- `user_id uuid not null references public.profiles(id) on delete cascade`
- `role text not null check role in `owner`, `admin`, `developer`, `viewer`
- `capabilities_override jsonb null`
- `invited_by_user_id uuid null references public.profiles(id) on delete set null`
- `workos_membership_id text null unique`
- `joined_at timestamptz not null default now()`
- `created_at timestamptz not null default now()`
- unique `(team_id, user_id)`

Add `public.team_invites`:

- `id uuid primary key default gen_random_uuid()`
- `team_id uuid not null references public.teams(id) on delete cascade`
- `email text not null`
- `role text not null check role in `admin`, `developer`, `viewer`
- `token_hash text not null unique`
- `invited_by_user_id uuid not null references public.profiles(id) on delete cascade`
- `accepted_by_user_id uuid null references public.profiles(id) on delete set null`
- `accepted_at timestamptz null`
- `revoked_at timestamptz null`
- `expires_at timestamptz not null`
- `workos_invitation_id text null unique`
- `created_at timestamptz not null default now()`

Alter `public.profiles`:

- `workos_user_id text null unique`
- `active_team_id uuid null references public.teams(id) on delete set null`

Owner invariant:

- A team must have exactly one `owner` member.
- Enforce "at most one" with a partial unique index on `(team_id)` where `role = 'owner'`.
- Ensure "at least one" through team creation helper transaction.

Invite invariants:

- Store normalized lowercase email in `team_invites.email`.
- Only one active invite may exist for the same `(team_id, email)` where `accepted_at is null`, `revoked_at is null`, and `expires_at > now()`.
- Accepting an invite must require the signed-in profile email to match the normalized invite email.

## Server Contract

Add `lib/team-context.ts`:

```ts
export type TeamRole = "owner" | "admin" | "developer" | "viewer";

export type TeamContext = {
  productTeamId: string;
  memberId: string;
  userId: string;
  role: TeamRole;
  isOwner: boolean;
  isAdmin: boolean;
};

export type TeamContextResolution =
  | { mode: "personal" }
  | { mode: "team"; context: TeamContext }
  | {
      mode: "invalid";
      code:
        | "TEAM_NOT_FOUND"
        | "TEAM_FORBIDDEN"
        | "TEAM_SUSPENDED"
        | "TEAM_CONTEXT_INVALID";
    };

export async function resolveActiveTeamContext(input: {
  userId: string;
  requestedProductTeamId?: string | null;
  storedProductTeamId?: string | null;
}): Promise<TeamContextResolution>;

export function isTeamAdminRole(role: TeamRole): boolean;
export function requireTeamContext(
  resolution: TeamContextResolution
): TeamContext;
export function requireTeamAdmin(context: TeamContext): TeamContext;
```

Resolution rules:

- No requested or stored team returns `{ mode: "personal" }`.
- Unknown requested/stored team returns `{ mode: "invalid", code: "TEAM_NOT_FOUND" }`.
- Non-member requested/stored team returns `{ mode: "invalid", code: "TEAM_FORBIDDEN" }`.
- Suspended requested/stored team returns `{ mode: "invalid", code: "TEAM_SUSPENDED" }`.
- Helper never falls back to owner/profile access for another team.

## Creation Gate

Add `lib/team-feature-gate.ts` with an allowlist style matching `lib/platform-access.ts`:

- `TEAMS_ENABLED_USER_IDS`
- `TEAMS_ENABLED_EMAILS`
- `TEAMS_ENABLED_EMAIL_DOMAINS`

Team creation helpers and later `POST /api/teams` routes must deny non-allowlisted users with `TEAM_CREATION_NOT_ENABLED`.

## RLS

Enable RLS for all three tables.

Policies:

- Team members can read their team row.
- Team members can read their own membership row; owner/admin can read all memberships in the team.
- Owner/admin can manage invites.
- End-user insert/update/delete for teams and members should be narrow or absent if route handlers use service-role helpers.

SQL helpers:

- Add `public.current_team_role(p_team_id uuid)` as `security definer` with `search_path = public`.
- Add `public.is_team_admin(p_team_id uuid)` as `security definer` with `search_path = public`.
- Policies should call helpers instead of recursively querying `team_members` from `team_members` policies.

## Acceptance Criteria

- Creating a team through the helper inserts both `teams` and the owner `team_members` row transactionally.
- Resolving active team context returns role flags for a valid member.
- Non-members and suspended teams resolve to `invalid`, not `personal`.
- A second owner membership for the same team is rejected.
- WorkOS external ID columns exist on `profiles`, `teams`, `team_members`, and `team_invites`, but are nullable and unused at runtime.
- Non-allowlisted users cannot create teams through the helper.

## Tests

- Unit tests for role predicates.
- Unit tests for active context resolution: absent team, valid member, unknown team, non-member, suspended team, stale stored team.
- Unit tests for team creation allowlist by id, email, and domain.
- Migration review for indexes, FK targets, owner uniqueness, invite uniqueness, RLS, and security-definer helpers.

## Handoff

Slice 02 depends on `TeamRole`, `TeamContext`, and `resolveActiveTeamContext`.
