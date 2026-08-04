-- Reserve the "company" slug at the DB slug-validation layer, mirroring the
-- addition of the /company marketing page in lib/reserved-slugs.ts. Without
-- this, a profile or team could claim the slug and its scoped dashboard would
-- never resolve (the app-side resolver rejects it).
--
-- Base definition mirrored from supabase/migrations/20260722150000
-- (frozen pre-cutover history; this file is the Neon-side continuation).
-- The dashboard-scoped first segments remain unmirrored (pre-existing
-- follow-up noted in lib/reserved-slugs.ts).

create or replace function public.is_reserved_slug(p_slug text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select lower(p_slug) = any (array[
    -- existing top-level routes
    'api','auth','cli-auth','company','conduct','faq','how-it-works','install',
    'login','privacy','request-access','slack','terms','unsubscribe','workflows',
    -- future reservations
    'new','invite','account','admin','support','status',
    -- infra / static
    'favicon.ico','robots.txt','sitemap.xml','llms.txt','opengraph-image',
    'apple-icon','icon','manifest.webmanifest',
    'global-error','not-found','error'
  ]);
$$;

-- Resolve pre-existing collisions: any profile or team that already owns the
-- newly reserved slug gets the standard numeric-suffix rename (same
-- convention as the phase-0 slug backfill). Idempotent — after the first run
-- no rows match.
do $$
declare
  r record;
  v_candidate text;
  v_n int;
begin
  for r in
    select 'profile' as kind, id, slug
    from public.profiles
    where slug = 'company'
    union all
    select 'team' as kind, id, slug
    from public.teams
    where slug = 'company'
  loop
    v_n := 1;
    loop
      v_n := v_n + 1;
      v_candidate := left(r.slug, 39 - length('-' || v_n::text)) || '-' || v_n::text;
      exit when
        not exists (select 1 from public.profiles where slug = v_candidate)
        and not exists (select 1 from public.teams where slug = v_candidate)
        and not public.is_reserved_slug(v_candidate);
    end loop;

    if r.kind = 'profile' then
      update public.profiles set slug = v_candidate where id = r.id;
    else
      update public.teams set slug = v_candidate, updated_at = now() where id = r.id;
    end if;
  end loop;
end $$;
