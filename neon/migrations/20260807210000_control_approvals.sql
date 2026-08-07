-- Control-plane approvals: durable record of every approval the orchestrator
-- requests — both AI SDK in-stream tool approvals (needsApproval gate) and
-- explicit request_approval calls. In-stream decisions resolve immediately
-- via the UI; rows are the audit trail today and become the source of truth
-- for headless approval modes (auto_dispatch / trusted_autopilot) later.
--
-- Loose coupling on purpose: run_id / ai_call_id are plain uuids (no FK) so
-- this migration is independent of the orchestration-runs migration and of
-- pre-cutover mirrored tables (billing-foundation convention).

create table if not exists public.control_approvals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  run_id uuid,
  ai_call_id uuid,
  tool_name text not null,
  -- AI SDK tool-call id for gate-created rows; request_approval rows get a
  -- synthetic id. Uniqueness is enforced only among unresolved rows so a
  -- retried tool call can request approval again after an expiry.
  tool_call_id text not null,
  tool_input jsonb not null default '{}'::jsonb,
  summary text not null,
  urgency text not null default 'normal'
    check (urgency in ('low', 'normal', 'high')),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied', 'expired', 'cancelled')),
  resolution_source text
    check (resolution_source in ('in_stream', 'api', 'auto', 'system')),
  expires_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid,
  resolution_note text,
  created_at timestamptz not null default now()
);

-- Scoped per user: tool-call ids are provider-generated and only meaningful
-- within a tenant; a cross-tenant collision must never block another user's
-- approval row.
create unique index control_approvals_pending_tool_call_key
  on public.control_approvals (user_id, tool_call_id)
  where status = 'pending';

create index control_approvals_user_pending_idx
  on public.control_approvals (user_id, created_at desc)
  where status = 'pending';

create index control_approvals_run_idx
  on public.control_approvals (run_id, created_at desc)
  where run_id is not null;

alter table public.control_approvals enable row level security;

-- Atomic resolution: only a pending, unexpired row owned by the caller can
-- resolve, and exactly once — a second resolver observes `false`.
create or replace function public.resolve_control_approval(
  p_approval_id uuid,
  p_user_id uuid,
  p_decision text,
  p_source text,
  p_note text default null
) returns boolean
language plpgsql
as $$
begin
  if p_decision not in ('approved', 'denied', 'expired', 'cancelled') then
    raise exception 'invalid approval decision %', p_decision;
  end if;

  update public.control_approvals
  set status = p_decision,
      resolved_at = now(),
      resolved_by = p_user_id,
      resolution_source = p_source,
      resolution_note = p_note
  where id = p_approval_id
    and user_id = p_user_id
    and status = 'pending'
    and (
      p_decision in ('expired', 'cancelled')
      or expires_at is null
      or expires_at > now()
    );

  return found;
end;
$$;

revoke all on function public.resolve_control_approval(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.resolve_control_approval(uuid, uuid, text, text, text)
  to service_role;
