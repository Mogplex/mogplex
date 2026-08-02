# Slice 12: WorkOS Migration Spike

Status: Proposed

## Owner

Auth architecture agent.

## Goal

Produce a decision record and prototype plan for moving from Supabase-session auth to WorkOS-compatible auth/org membership, without changing production auth behavior.

## Write Scope

- `docs/enterprise-teams-rbac/workos-decision-record.md`
- Optional throwaway prototype notes under `docs/enterprise-teams-rbac/workos-spike-notes.md`
- No production auth code unless explicitly approved in a later implementation spec

## Questions To Answer

1. Does WorkOS become auth only, while Mogplex keeps local capabilities?
2. Does WorkOS become the source of truth for organization membership and roles?
3. Are WorkOS permissions used directly, or mapped into local `team_members.capabilities_override`?
4. How does Supabase RLS receive trusted identity after WorkOS sessions?
5. How are existing Supabase-auth profiles linked to WorkOS users?
6. What happens to CLI PAT auth, Playwright auth bypass, machine auth, and internal delegated auth?

## Current Auth Seams To Inspect

- `proxy.ts`: Supabase session refresh and redirect.
- `lib/auth.ts`: `getResolvedAuth`, PAT precedence, Playwright auth, Supabase profile lookup.
- `app/api/auth/user/route.ts`: profile payload and platform access derivation.
- RLS function `public.current_profile_id()`.
- PAT allowlist behavior in `lib/auth-route-policy.ts`.
- CLI auth and API key routes under `app/api/settings/api-keys/**`.

## Target Compatibility Mapping

Local schema maps:

- `profiles.workos_user_id` to WorkOS user id.
- `teams.workos_organization_id` to WorkOS organization id.
- `team_members.workos_membership_id` to WorkOS organization membership id.
- WorkOS role slug to local `team_members.role`.
- WorkOS permissions to local capabilities only if the decision record chooses WorkOS as permission source.

## Supabase Integration Notes

Supabase supports WorkOS as third-party auth. The spike must decide whether to:

- Trust WorkOS JWTs directly in Supabase clients.
- Keep server-side service-role access for app APIs and use WorkOS only for session identity.
- Run both Supabase Auth and WorkOS during migration.

Any direct Supabase JWT path must account for Supabase expecting a JWT `role` claim compatible with Postgres roles, while WorkOS organization role data should move to a separate claim.

## Acceptance Criteria

- Decision record recommends one auth/org strategy.
- Migration plan includes old/new session handling and rollback.
- Existing `profiles.id` continuity is preserved or an explicit migration is documented.
- RLS impact is documented with concrete policy/function changes.
- PAT, Playwright, internal API, and machine auth behavior are addressed.
- No production auth change ships from the spike.

## Tests For A Future Auth Migration

- Unit: `getResolvedAuth` resolves WorkOS sessions to existing profile ids.
- Unit: PAT auth precedence remains above browser session.
- Unit: unauthenticated proxy redirects still work.
- E2E: existing logged-in user can access dashboard after migration.
- E2E: WorkOS organization selection sets active team context.

## Handoff

A future WorkOS implementation PR must start from the decision record, not this spike prompt alone.
