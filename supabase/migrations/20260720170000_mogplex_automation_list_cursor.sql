-- Support stable keyset pagination for the external Mogplex automation list.
create index if not exists idx_flows_user_created_id
  on public.flows (user_id, created_at desc, id desc);
