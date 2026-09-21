-- Per-connection approval override. Additive only: the default is 'auto', which
-- is how every connection behaves today (its tools run without asking), and
-- nothing the deployed app or workers read or write changes. Adding a column
-- with a constant default does not rewrite the table.
alter table public.connections
  add column if not exists approval_mode text not null default 'auto';

alter table public.connections
  drop constraint if exists connections_approval_mode_check;

alter table public.connections
  add constraint connections_approval_mode_check
  check (approval_mode = any (array['auto'::text, 'ask'::text]));

comment on column public.connections.approval_mode is
  'auto: the connection''s tools run without asking. ask: each tool call needs the user''s approval; surfaces that cannot ask withhold the tools.';
