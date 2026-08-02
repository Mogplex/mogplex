# Slice 07: Team API Foundation and Active Switcher

Status: Proposed

## Owner

Team API shell agent.

## Goal

Expose team summaries and active team switching without building the full admin console.

## Write Scope

- `app/api/teams/route.ts`
- `app/api/teams/[productTeamId]/route.ts`
- `app/api/teams/active/route.ts`
- `app/api/auth/user/route.ts`
- `hooks/use-user.ts`
- Top-bar or shell team switcher component
- Focused route tests and one Playwright switcher smoke test

Do not add member management, invite management, or capability editing in this slice.

## API Contract

```txt
GET   /api/teams
GET   /api/teams/:productTeamId
POST  /api/teams
PATCH /api/teams/active
```

`POST /api/teams` must use the creation gate from Slice 01 and return `TEAM_CREATION_NOT_ENABLED` for non-allowlisted users.

Use `productTeamId` in request/response TypeScript and route parameter naming.

## Active Switching

`PATCH /api/teams/active` body:

```json
{ "productTeamId": "uuid-or-null" }
```

Rules:

- `null` selects personal mode.
- Valid member team stores `profiles.active_team_id`.
- Unknown, non-member, or suspended team returns 403 with stable code and does not update the stored preference.
- Stored stale team from older state appears as `team_context_error` in `/api/auth/user`.

## UI

Add a compact switcher:

- Show `Personal`.
- Show teams the user belongs to.
- Show an error state if the stored active team is invalid.
- Changing team refreshes model/tool/sandbox availability caches.

No large settings tab work in this slice.

## Acceptance Criteria

- Team creation is gated from the first public API.
- Active team can switch to valid team or personal mode.
- Invalid switch cannot fall back to personal mode.
- Auth-user payload includes team summaries and active selection.
- Existing users with no teams see no disruptive UI.

## Tests

- Unit route tests for list, get, create gate, and active switch.
- Unit `/api/auth/user` tests for no teams, valid active team, stale active team.
- E2E: switch from personal to team and back.

## Handoff

Slice 08 adds member/invite management under the API foundation created here.
