-- Team custom icons.
--
-- Adds teams.icon_path (object key inside the team-icons bucket). The public
-- URL is computed at read time from this path — we never persist the URL, so
-- there is no DB-level vector for an attacker (or future bad migration) to
-- swap in an arbitrary origin that the app would then render as <img src>.
--
-- Storage: new public `team-icons` bucket. Objects are namespaced by team id —
-- the first path segment must equal the team UUID. Writes/deletes require
-- is_team_admin() on that team; reads are public so icons render anywhere.
--
-- SVG is intentionally NOT in the allow-list: it can carry inline <script>
-- and event handlers, and a public CDN serving image/svg+xml is a stored-XSS
-- vector. Stick to raster formats.

alter table public.teams
  add column if not exists icon_path text;

-- ---------------------------------------------------------------
-- Storage bucket
-- ---------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'team-icons',
  'team-icons',
  true,
  2 * 1024 * 1024, -- 2 MB
  array['image/png','image/jpeg','image/webp','image/gif']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------
-- Storage RLS
-- First path segment of the object name must be the team UUID;
-- only owners/admins of that team may write or delete.
--
-- No public SELECT policy: direct fetches of icon files go through the
-- public CDN endpoint (/storage/v1/object/public/...) which bypasses RLS
-- on storage.objects, so <img src=...> rendering keeps working. Omitting
-- the SELECT policy denies the Storage list API (and the authenticated
-- object endpoint), which would otherwise let any anon client enumerate
-- every team UUID and object path in the bucket.
-- ---------------------------------------------------------------

-- Drop the previously over-broad read policy if it was created by an
-- earlier revision of this migration in a non-prod environment.
drop policy if exists team_icons_read on storage.objects;

drop policy if exists team_icons_insert on storage.objects;
create policy team_icons_insert on storage.objects
  for insert
  with check (
    bucket_id = 'team-icons'
    and public.is_team_admin(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists team_icons_update on storage.objects;
create policy team_icons_update on storage.objects
  for update
  using (
    bucket_id = 'team-icons'
    and public.is_team_admin(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'team-icons'
    and public.is_team_admin(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists team_icons_delete on storage.objects;
create policy team_icons_delete on storage.objects
  for delete
  using (
    bucket_id = 'team-icons'
    and public.is_team_admin(((storage.foldername(name))[1])::uuid)
  );
