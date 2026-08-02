-- Add non-GitHub workflow trigger sources and keep per-flow webhook secrets in
-- Supabase Vault. Trigger configuration itself remains versioned in the start
-- node so every run can resolve the immutable published contract.

alter table public.flows
  add column if not exists trigger_schedule_id text,
  add column if not exists vault_webhook_secret_id uuid;

alter table public.flows
  drop constraint if exists flows_source_kind_check;

alter table public.flows
  add constraint flows_source_kind_check
  check (source_kind in ('github', 'schedule', 'webhook', 'slack'));

create or replace function public.store_flow_webhook_secret(
  p_flow_id uuid,
  p_user_id uuid,
  p_secret text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_secret_id uuid;
  v_new_secret_id uuid;
begin
  -- Serialize rotations for this flow so concurrent requests cannot both
  -- create a secret and orphan the loser.
  select vault_webhook_secret_id into v_existing_secret_id
  from public.flows
  where id = p_flow_id
    and user_id = p_user_id
  for update;

  if not found then
    raise exception 'Flow not found';
  end if;

  if v_existing_secret_id is not null then
    delete from vault.secrets where id = v_existing_secret_id;
  end if;

  select vault.create_secret(
    p_secret,
    'flow/' || p_flow_id::text || '/webhook_secret',
    'Signed webhook secret for workflow ' || p_flow_id::text
  ) into v_new_secret_id;

  if v_new_secret_id is null then
    raise exception 'vault.create_secret returned null for flow %', p_flow_id;
  end if;

  update public.flows
  set vault_webhook_secret_id = v_new_secret_id,
      updated_at = now()
  where id = p_flow_id
    and user_id = p_user_id;

  return v_new_secret_id;
end;
$$;

create or replace function public.get_flow_webhook_secret(
  p_flow_id uuid
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret_id uuid;
  v_secret text;
begin
  select vault_webhook_secret_id into v_secret_id
  from public.flows
  where id = p_flow_id;

  if v_secret_id is null then
    return null;
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where id = v_secret_id;

  return v_secret;
end;
$$;

create or replace function public.delete_flow_webhook_secret()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.vault_webhook_secret_id is not null then
    delete from vault.secrets where id = old.vault_webhook_secret_id;
  end if;
  return old;
end;
$$;

drop trigger if exists delete_flow_webhook_secret_on_flow_delete
  on public.flows;
create trigger delete_flow_webhook_secret_on_flow_delete
  before delete on public.flows
  for each row execute function public.delete_flow_webhook_secret();

revoke all on function public.store_flow_webhook_secret(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.get_flow_webhook_secret(uuid)
  from public, anon, authenticated;
grant execute on function public.store_flow_webhook_secret(uuid, uuid, text)
  to service_role;
grant execute on function public.get_flow_webhook_secret(uuid)
  to service_role;
