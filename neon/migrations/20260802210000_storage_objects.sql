-- App-served object storage replacing Supabase Storage buckets (only
-- provider-icons uses object storage today). Objects are small (icon PNGs),
-- so bytea-in-Postgres beats standing up a second storage service; the app
-- serves them from /storage/v1/object/public/<bucket>/<path> to keep the
-- existing public URL shape working.
create table if not exists storage_objects (
  bucket text not null,
  name text not null,
  content_type text not null default 'application/octet-stream',
  data bytea not null,
  updated_at timestamptz not null default now(),
  primary key (bucket, name)
);
