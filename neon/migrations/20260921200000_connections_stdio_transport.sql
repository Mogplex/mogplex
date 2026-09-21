-- Quick-add presets can now describe an MCP server that runs as a local
-- process (Trigger.dev ships only a stdio server). Those rows store
-- mcp_transport = 'stdio' and no mcp_url; the command itself lives in the
-- preset definition, never in the row.
alter table public.connections
  drop constraint if exists connections_mcp_transport_check;

alter table public.connections
  add constraint connections_mcp_transport_check
  check (mcp_transport = any (array['sse'::text, 'http'::text, 'stdio'::text]));
