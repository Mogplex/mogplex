-- Reserve the Sentry tunnel route. The proxy treats /monitoring as public and
-- never resolves a scope under it, so a workspace with this slug could not load.
-- New claims are refused, and a profile or team that already holds the slug is
-- renamed below with the standard numeric suffix (its old URL never loaded).
create or replace function public.is_reserved_slug(p_slug text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select lower(p_slug) = any (array[
    'api',
    'auth',
    'cli-auth',
    'checkout',
    'company',
    'conduct',
    'faq',
    'forgot-password',
    'how-it-works',
    'install',
    'install.sh',
    'install.ps1',
    'login',
    'oauth',
    'pricing',
    'privacy',
    'request-access',
    'reset-password',
    'signup',
    'slack',
    'storage',
    'terms',
    'unsubscribe',
    'workflows',
    'new',
    'invite',
    'account',
    'admin',
    'support',
    'status',
    '.well-known',
    'favicon.ico',
    'robots.txt',
    'sitemap.xml',
    'llms.txt',
    'monitoring',
    'opengraph-image',
    'apple-icon',
    'icon',
    'manifest.webmanifest',
    'global-error',
    'not-found',
    'error',
    'agents',
    'assignments',
    'automations',
    'connections',
    'control',
    'delivery',
    'flows',
    'library',
    'models',
    'observability',
    'observe',
    'primitives',
    'projects',
    'runs',
    'sandboxes',
    'settings',
    'triggers'
  ]);
$$;

-- Resolve pre-existing collisions: any profile or team that already owns the
-- newly reserved slug gets the standard numeric-suffix rename. Idempotent.
do $$
declare
  r record;
  v_candidate text;
  v_n int;
begin
  for r in
    select 'profile' as kind, id, slug
    from public.profiles
    where slug = 'monitoring'
    union all
    select 'team' as kind, id, slug
    from public.teams
    where slug = 'monitoring'
  loop
    v_n := 1;
    loop
      v_n := v_n + 1;
      -- 39 is the slug length cap (SLUG_MAX_LEN in lib/profile-slug.ts, lib/team-slug.ts).
      v_candidate := left(r.slug, 39 - length('-' || v_n::text)) || '-' || v_n::text;
      exit when
        not exists (select 1 from public.profiles where slug = v_candidate)
        and not exists (select 1 from public.teams where slug = v_candidate)
        and not public.is_reserved_slug(v_candidate);
    end loop;

    raise notice 'reserved slug %: % % renamed to %', r.slug, r.kind, r.id, v_candidate;

    if r.kind = 'profile' then
      update public.profiles set slug = v_candidate where id = r.id;
    else
      update public.teams set slug = v_candidate, updated_at = now() where id = r.id;
    end if;
  end loop;
end $$;
