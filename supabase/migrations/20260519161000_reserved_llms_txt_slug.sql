-- Reserve /llms.txt at the DB slug-validation layer.

create or replace function public.is_reserved_slug(p_slug text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select lower(p_slug) = any (array[
    -- existing top-level routes
    'api','auth','cli-auth','conduct','install','login',
    'privacy','request-access','slack','terms','unsubscribe',
    -- future reservations
    'new','invite','account','admin','support','status',
    -- infra / static
    'favicon.ico','robots.txt','sitemap.xml','llms.txt','opengraph-image',
    'apple-icon','icon','manifest.webmanifest',
    'global-error','not-found','error'
  ]);
$$;
