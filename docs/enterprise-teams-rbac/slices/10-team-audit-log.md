# Slice 10: Team Audit Log

Status: Proposed

## Owner

Audit and observability agent.

## Goal

Record team administration and denied-action events with enough correlation to existing Mogplex observability.

## Write Scope

- `supabase/migrations/*_team_audit_events.sql`
- `lib/team-audit.ts`
- Team API routes from Slices 07 through 09
- Denial hooks from Slices 05 and 06
- Team settings audit viewer component
- Tests in `tests/unit/*team-audit*` and one E2E settings audit test

## Data Model

Add `public.team_audit_events`:

- `id uuid primary key default gen_random_uuid()`
- `team_id uuid not null references public.teams(id) on delete cascade`
- `actor_user_id uuid null references public.profiles(id) on delete set null`
- `actor_member_id uuid null references public.team_members(id) on delete set null`
- `action text not null`
- `decision_code text null`
- `target_type text not null`
- `target_id text null`
- `repo_id uuid null references public.repos(id) on delete set null`
- `sandbox_record_id uuid null references public.sandboxes(id) on delete set null`
- `ai_call_id uuid null`
- `job_run_id uuid null`
- `request_id text null`
- `auth_source text null`
- `payload jsonb not null default '{}'::jsonb`
- `created_at timestamptz not null default now()`

Indexes:

- `(team_id, created_at desc)`
- `(actor_user_id, created_at desc)`
- `(action, created_at desc)`
- `(decision_code, created_at desc)`

## Actions

Capture:

- `team.created`
- `team.updated`
- `invite.created`
- `invite.revoked`
- `invite.accepted`
- `member.role_changed`
- `member.removed`
- `member.capabilities_changed`
- `model.denied`
- `tool.denied`
- `sandbox.denied`
- `billing.denied`

Payload rules:

- Never store secrets, invite plaintext tokens, provider keys, or raw prompts.
- Store before/after role and capability metadata when useful.
- Store denied model/tool IDs and reason codes.
- Correlate to `ai_calls`, `job_runs`, sandbox record, and repo when available.

## Server Contract

```ts
export async function recordTeamAuditEvent(input: {
  productTeamId: string;
  actorUserId?: string | null;
  actorMemberId?: string | null;
  action: string;
  decisionCode?: string | null;
  targetType: string;
  targetId?: string | null;
  correlations?: {
    repoId?: string | null;
    sandboxRecordId?: string | null;
    aiCallId?: string | null;
    jobRunId?: string | null;
    requestId?: string | null;
    authSource?: string | null;
  };
  payload?: Record<string, unknown>;
}): Promise<void>;
```

Audit writes are best-effort for denied model/tool/sandbox events. Admin mutations should write audit events in the same transaction when practical; if not practical, they must log write failures.

## API/UI

```txt
GET /api/teams/:productTeamId/audit-events?cursor=<created_at/id cursor>
```

Only owner/admin with `members.manage` can read audit events.

## Acceptance Criteria

- Member and capability mutations write audit events.
- Denied model/tool/sandbox actions write correlated audit events when team context is known.
- Audit viewer is admin-only.
- Audit payloads do not include secrets or plaintext invite tokens.

## Tests

- Unit: audit helper redacts unsafe payload fields.
- Unit: mutation route writes expected audit event.
- Unit: audit read route denies developer/viewer.
- E2E: owner changes a role and sees audit entry.

## Handoff

Slice 11 should use audit events for plan/billing denied states rather than adding a separate event table.
