-- Persist AI provider logos in storage we control. The model sync is the only
-- writer and uses the service-role client, so no storage.objects write policies
-- are needed. Public object URLs let the model catalog render the stored copy
-- without depending on the upstream docs asset host at request time.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'provider-icons',
  'provider-icons',
  true,
  512 * 1024,
  array['image/png']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Keep Storage API writes service-role-only if this migration is replayed over
-- an environment where experimental policies were created.
drop policy if exists provider_icons_read on storage.objects;
drop policy if exists provider_icons_insert on storage.objects;
drop policy if exists provider_icons_update on storage.objects;
drop policy if exists provider_icons_delete on storage.objects;
