import assert from "node:assert/strict";
import test from "node:test";
import {
  getConnectionDisplayState,
  getPresetConnectionState,
} from "../../lib/connections/presentation";
import {
  ConnectionTestPersistenceError,
  ensureConnectionTestWriteSucceeded,
} from "../../lib/connections/test-persistence";
import type { Connection } from "../../lib/types";

function createConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: overrides.id ?? "conn-1",
    user_id: "user-1",
    name: "Supabase",
    type: "mcp_server",
    base_url: null,
    auth_type: "bearer",
    auth_header: "Authorization",
    mcp_transport: "http",
    mcp_url: "https://mcp.supabase.com/mcp",
    description: "Connection",
    is_enabled: true,
    health_status: "unknown",
    scope: "global",
    repo_id: null,
    oauth_client_id: null,
    oauth_authorize_url: null,
    oauth_token_url: null,
    oauth_scopes: null,
    oauth_authorized_at: null,
    oauth_token_expires_at: null,
    source_preset: "supabase",
    last_tested_at: null,
    last_test_error: null,
    last_test_http_status: null,
    last_test_tool_count: null,
    created_at: "2026-03-20T00:00:00.000Z",
    updated_at: "2026-03-20T00:00:00.000Z",
    ...overrides,
  };
}

test("oauth display state keeps reconnect available after tokens expire", () => {
  const displayState = getConnectionDisplayState(
    createConnection({
      auth_type: "oauth",
      health_status: "auth_failed",
      oauth_authorized_at: "2026-03-18T00:00:00.000Z",
      oauth_token_expires_at: "2026-03-19T00:00:00.000Z",
    })
  );

  assert.equal(displayState.oauthActionLabel, "Reconnect");
});

test("oauth display state shows connect before the first authorization completes", () => {
  const displayState = getConnectionDisplayState(
    createConnection({
      auth_type: "oauth",
      source_preset: "notion",
      oauth_authorized_at: null,
    })
  );

  assert.equal(displayState.oauthActionLabel, "Connect");
});

test("legacy non-OAuth rows surface reconnect before native migration completes", () => {
  const displayState = getConnectionDisplayState({
    ...createConnection({
      auth_type: "bearer",
      source_preset: "sentry",
      oauth_authorized_at: null,
    }),
    needsOAuthMigration: true,
  });

  assert.equal(displayState.oauthActionLabel, "Reconnect");
});

test("preset state treats disabled or excluded preset rows as configured, not addable", () => {
  const disabledPreset = getPresetConnectionState(
    { presetId: "supabase", requiresOAuth: false },
    [createConnection({ is_enabled: false })]
  );

  assert.equal(disabledPreset.isAddable, false);
  assert.equal(disabledPreset.label, "Configured");
  assert.equal(disabledPreset.detail, "Disabled");

  const excludedPreset = getPresetConnectionState(
    { presetId: "supabase", requiresOAuth: false },
    [createConnection()],
    new Set(["conn-1"])
  );

  assert.equal(excludedPreset.isAddable, false);
  assert.equal(excludedPreset.label, "Configured");
  assert.equal(excludedPreset.detail, "Excluded from this project");

  const oauthPreset = getPresetConnectionState(
    { presetId: "notion", requiresOAuth: true },
    [
      createConnection({
        auth_type: "oauth",
        source_preset: "notion",
        oauth_authorized_at: null,
      }),
    ]
  );

  assert.equal(oauthPreset.isAddable, false);
  assert.equal(oauthPreset.label, "Configured");
  assert.equal(oauthPreset.detail, "OAuth authorization required");

  const sentryLegacyPreset = getPresetConnectionState(
    { presetId: "sentry", requiresOAuth: true },
    [
      createConnection({
        auth_type: "bearer",
        source_preset: "sentry",
        oauth_authorized_at: null,
      }),
    ]
  );

  assert.equal(sentryLegacyPreset.isAddable, false);
  assert.equal(sentryLegacyPreset.label, "Configured");
  assert.match(sentryLegacyPreset.detail || "", /Reconnect with OAuth/);

  const sentryBrokerPreset = getPresetConnectionState(
    { presetId: "sentry", requiresOAuth: true },
    [
      createConnection({
        auth_type: "oauth",
        source_preset: "sentry",
        oauth_authorized_at: "2026-03-18T00:00:00.000Z",
        oauth_client_id: null,
      }),
    ]
  );

  assert.equal(sentryBrokerPreset.label, "Configured");
  assert.match(sentryBrokerPreset.detail || "", /Reconnect with OAuth/);
});

test("preset state prefers the available connection when duplicate historical rows exist", () => {
  const state = getPresetConnectionState(
    { presetId: "supabase", requiresOAuth: false },
    [
      createConnection({
        id: "conn-disabled",
        is_enabled: false,
        created_at: "2026-03-19T00:00:00.000Z",
      }),
      createConnection({
        id: "conn-enabled",
        is_enabled: true,
        created_at: "2026-03-20T00:00:00.000Z",
      }),
    ]
  );

  assert.equal(state.connection?.id, "conn-enabled");
  assert.equal(state.label, "Connected");
});

test("test persistence helper throws a dedicated error when writes fail", () => {
  assert.throws(
    () =>
      ensureConnectionTestWriteSucceeded(
        { message: "column last_test_error does not exist" },
        "Connection test completed but the result could not be saved"
      ),
    (error: unknown) =>
      error instanceof ConnectionTestPersistenceError &&
      error.message ===
        "Connection test completed but the result could not be saved" &&
      error.causeMessage === "column last_test_error does not exist"
  );
});
