import assert from "node:assert/strict";
import test from "node:test";
import type { Connection } from "../../lib/types";

test("resource binding is opt-in and does not change the Notion OAuth flow", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  const { getOAuthResourceIndicator } =
    await import("../../lib/connections/oauth");
  const connection = (source_preset: string, mcp_url: string) =>
    ({ source_preset, mcp_url, type: "mcp_server" }) as Connection;

  assert.equal(
    getOAuthResourceIndicator(
      connection("sentry", "https://mcp.sentry.dev/mcp")
    ),
    "https://mcp.sentry.dev/mcp"
  );
  assert.equal(
    getOAuthResourceIndicator(
      connection("notion", "https://mcp.notion.com/mcp")
    ),
    undefined
  );
});
