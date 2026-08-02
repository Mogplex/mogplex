-- Serialize each workflow's pause/resume saga across application instances.
-- A separate internal table keeps lock ownership out of the user-writable
-- flows row. The application releases locks immediately; locked_at is retained
-- only for operator diagnostics and never expires a live holder's ownership.

create table if not exists public.flow_activation_locks (
  flow_id uuid primary key references public.flows(id) on delete cascade,
  lock_token uuid not null,
  locked_at timestamptz not null
);

alter table public.flow_activation_locks enable row level security;

revoke all on table public.flow_activation_locks
  from public, anon, authenticated;
grant select, insert, update, delete on table public.flow_activation_locks
  to service_role;

comment on table public.flow_activation_locks is
  'Service-role mutexes for cross-system workflow pause/resume sagas.';
