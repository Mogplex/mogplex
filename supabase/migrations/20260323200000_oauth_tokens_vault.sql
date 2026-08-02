create table if not exists public.oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider in ('github', 'vercel')),
  vault_secret_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint oauth_tokens_user_provider_key unique (user_id, provider)
);

alter table public.oauth_tokens enable row level security;

drop policy if exists "owner_select" on public.oauth_tokens;
create policy "owner_select" on public.oauth_tokens
  for select using (user_id = public.current_profile_id());

create or replace function public.store_oauth_token(
  p_user_id uuid,
  p_provider text,
  p_token text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_secret_id uuid;
  v_new_secret_id uuid;
begin
  select vault_secret_id into v_existing_secret_id
  from public.oauth_tokens
  where user_id = p_user_id and provider = p_provider;

  if v_existing_secret_id is not null then
    delete from vault.secrets where id = v_existing_secret_id;
  end if;

  select vault.create_secret(
    p_token,
    p_user_id || '/' || p_provider || '/oauth',
    'OAuth token for ' || p_provider
  ) into v_new_secret_id;

  insert into public.oauth_tokens (user_id, provider, vault_secret_id, updated_at)
  values (p_user_id, p_provider, v_new_secret_id, now())
  on conflict (user_id, provider)
  do update set vault_secret_id = v_new_secret_id, updated_at = now();
end;
$$;

create or replace function public.get_oauth_token(
  p_user_id uuid,
  p_provider text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret_id uuid;
  v_decrypted text;
begin
  select vault_secret_id into v_secret_id
  from public.oauth_tokens
  where user_id = p_user_id and provider = p_provider;

  if v_secret_id is null then
    return null;
  end if;

  select decrypted_secret into v_decrypted
  from vault.decrypted_secrets
  where id = v_secret_id;

  return v_decrypted;
end;
$$;

create or replace function public.has_oauth_token(
  p_user_id uuid,
  p_provider text
) returns boolean
language sql
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.oauth_tokens
    where user_id = p_user_id and provider = p_provider
  );
$$;

create or replace function public.delete_oauth_token(
  p_user_id uuid,
  p_provider text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret_id uuid;
begin
  select vault_secret_id into v_secret_id
  from public.oauth_tokens
  where user_id = p_user_id and provider = p_provider;

  if v_secret_id is not null then
    delete from vault.secrets where id = v_secret_id;
    delete from public.oauth_tokens where user_id = p_user_id and provider = p_provider;
  end if;
end;
$$;

do $$
declare
  v_profile record;
begin
  for v_profile in
    select id, github_token, vercel_token
    from public.profiles
    where coalesce(github_token, '') <> ''
       or coalesce(vercel_token, '') <> ''
  loop
    if coalesce(v_profile.github_token, '') <> '' then
      perform public.store_oauth_token(v_profile.id, 'github', v_profile.github_token);
    end if;

    if coalesce(v_profile.vercel_token, '') <> '' then
      perform public.store_oauth_token(v_profile.id, 'vercel', v_profile.vercel_token);
    end if;
  end loop;
end;
$$;
