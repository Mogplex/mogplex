-- Reserve the authenticated /checkout route so scope resolution can never
-- reinterpret it as a personal or team workspace slug.

create or replace function public.is_reserved_slug(p_slug text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select lower(p_slug) = any (array[
    -- existing top-level routes
    'api','auth','checkout','cli-auth','company','conduct','faq','how-it-works',
    'install','login','pricing','privacy','request-access','slack','terms',
    'unsubscribe','workflows',
    -- future reservations
    'new','invite','account','admin','support','status',
    -- infra / static
    'favicon.ico','robots.txt','sitemap.xml','llms.txt','opengraph-image',
    'apple-icon','icon','manifest.webmanifest',
    'global-error','not-found','error'
  ]);
$$;

-- Resolve a pre-existing collision with the same deterministic suffixing used
-- for earlier route reservations. The migration is idempotent.
do $$
declare
  r record;
  v_candidate text;
  v_n int;
begin
  for r in
    select 'profile' as kind, id, slug
    from public.profiles
    where slug = 'checkout'
    union all
    select 'team' as kind, id, slug
    from public.teams
    where slug = 'checkout'
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
