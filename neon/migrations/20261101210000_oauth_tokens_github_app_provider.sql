-- Store GitHub App user authorizations beside the existing OAuth grants. A
-- personal-account repository can only be created with a user token issued by
-- the GitHub App, so those grants need their own provider value. Expand only:
-- existing 'github' and 'vercel' rows and every reader of them are unchanged.
alter table public.oauth_tokens
  drop constraint if exists oauth_tokens_provider_check;

alter table public.oauth_tokens
  add constraint oauth_tokens_provider_check
  check (provider = any (array['github'::text, 'vercel'::text, 'github_app'::text]));

-- GitHub rotates App user refresh tokens on use, so two requests can refresh
-- the same grant at once and the loser sees its token rejected. The loser may
-- forget the grant only while it is still the one GitHub rejected: the row lock
-- orders this against store_oauth_token, so a newer grant is never deleted.
create or replace function public.delete_oauth_token_if_unchanged(
  p_user_id uuid,
  p_provider text,
  p_expected text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret_id uuid;
  v_current text;
begin
  select vault_secret_id into v_secret_id
  from public.oauth_tokens
  where user_id = p_user_id and provider = p_provider
  for update;

  if v_secret_id is null then
    return false;
  end if;

  select decrypted_secret into v_current
  from vault.decrypted_secrets
  where id = v_secret_id;

  if v_current is distinct from p_expected then
    return false;
  end if;

  delete from vault.secrets where id = v_secret_id;
  delete from public.oauth_tokens
  where user_id = p_user_id and provider = p_provider;
  return true;
end;
$$;

revoke all on function public.delete_oauth_token_if_unchanged(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.delete_oauth_token_if_unchanged(uuid, text, text)
  to service_role;
