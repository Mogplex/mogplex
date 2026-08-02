# Slice 08: Member, Invite, and Role Management

Status: Proposed

## Owner

Team membership agent.

## Goal

Add safe owner/admin management for invites, member roles, and membership removal.

## Write Scope

- `app/api/teams/[productTeamId]/members/**`
- `app/api/teams/[productTeamId]/invites/**`
- Membership service helpers under `lib/team-members.ts`
- Route tests
- Minimal settings UI for member and invite tables

Do not add capability editors or model allowlist UI in this slice.

## API Contract

```txt
GET    /api/teams/:productTeamId/members
PATCH  /api/teams/:productTeamId/members/:memberId
DELETE /api/teams/:productTeamId/members/:memberId
GET    /api/teams/:productTeamId/invites
POST   /api/teams/:productTeamId/invites
POST   /api/teams/:productTeamId/invites/:inviteId/accept
POST   /api/teams/:productTeamId/invites/:inviteId/revoke
```

Errors:

- `TEAM_FORBIDDEN`
- `TEAM_MEMBER_NOT_FOUND`
- `TEAM_INVITE_INVALID`
- `TEAM_INVITE_EXPIRED`
- `TEAM_LAST_OWNER`
- `TEAM_ROLE_ESCALATION_DENIED`

## Rules

- Only users with `members.manage` can invite, revoke, change roles, or remove members.
- Only owners can grant owner/admin roles.
- Admins cannot grant capabilities or roles beyond their own authority.
- Members cannot change their own role.
- The last owner cannot be demoted or removed.
- Accepting an invite requires matching normalized profile email.
- Duplicate active invites for the same team/email are rejected or idempotently return the existing invite.

## Acceptance Criteria

- Owner can invite, revoke, and change roles.
- Admin can manage lower roles but cannot create owners or self-escalate.
- Developer/viewer cannot manage members.
- Invite acceptance creates membership once and is safe under double-submit.
- Last owner protections are transactionally enforced.

## Tests

- Unit route tests for every endpoint.
- Unit transaction tests for double accept and last-owner demotion/removal races.
- E2E: owner invites, member accepts, owner changes role.
- E2E: developer cannot access mutation controls.

## Handoff

Slice 09 adds capability/model editing for existing members.
