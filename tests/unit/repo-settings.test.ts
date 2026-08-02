import assert from "node:assert/strict";
import test from "node:test";

async function loadRepoSettings() {
  return import("../../lib/repo-settings");
}

test("resolveConfiguredDevPort treats auto mode as unset", async () => {
  const { resolveConfiguredDevPort } = await loadRepoSettings();
  assert.equal(resolveConfiguredDevPort(3000, true), null);
  assert.equal(resolveConfiguredDevPort("5173", false), 5173);
});

test("normalizeRepoSettings preserves dev_port_auto", async () => {
  const { normalizeRepoSettings } = await loadRepoSettings();
  const result = normalizeRepoSettings({
    dev_port: 3000,
    dev_port_auto: false,
  });
  assert.equal(result.dev_port, 3000);
  assert.equal(result.dev_port_auto, false);
});

test("parseEnvVarsText unwraps quoted dotenv-style values", async () => {
  const { parseEnvVarsText } = await loadRepoSettings();

  assert.deepEqual(
    parseEnvVarsText(
      [
        'AUTH_URL="https://auth.creditrenew.com"',
        "API_TOKEN='secret-token'",
        "PLAIN_VALUE=enabled",
        String.raw`ESCAPED="line one\nline two"`,
      ].join("\n")
    ),
    {
      AUTH_URL: "https://auth.creditrenew.com",
      API_TOKEN: "secret-token",
      PLAIN_VALUE: "enabled",
      ESCAPED: "line one\nline two",
    }
  );
});

test("parseEnvVarsText preserves whitespace for unquoted values and trims only around quoted values", async () => {
  const { parseEnvVarsText } = await loadRepoSettings();

  assert.deepEqual(
    parseEnvVarsText(
      [
        "  PADDED_KEY =  padded value  ",
        'TRIMMED_QUOTED =   "quoted value"   ',
      ].join("\n")
    ),
    {
      PADDED_KEY: "  padded value  ",
      TRIMMED_QUOTED: "quoted value",
    }
  );
});

test("normalizeRepoSettingsPatch defaults dev_port_auto to true when explicitly set", async () => {
  const { normalizeRepoSettingsPatch } = await loadRepoSettings();
  assert.deepEqual(
    normalizeRepoSettingsPatch({
      dev_port_auto: "true",
    }),
    {
      dev_port_auto: true,
    }
  );
});

test("normalizeSandboxTimeoutMs clamps to the supported 10 minute to 5 hour range", async () => {
  const {
    MIN_SANDBOX_TIMEOUT_MS,
    MAX_SANDBOX_TIMEOUT_MS,
    normalizeSandboxTimeoutMs,
  } = await loadRepoSettings();

  assert.equal(normalizeSandboxTimeoutMs(60_000), MIN_SANDBOX_TIMEOUT_MS);
  assert.equal(
    normalizeSandboxTimeoutMs(MAX_SANDBOX_TIMEOUT_MS + 60_000),
    MAX_SANDBOX_TIMEOUT_MS
  );
});

test("DEFAULT_SANDBOX_TIMEOUT_MS is 5 hours", async () => {
  const { DEFAULT_SANDBOX_TIMEOUT_MS, MAX_SANDBOX_TIMEOUT_MS } =
    await loadRepoSettings();
  assert.equal(DEFAULT_SANDBOX_TIMEOUT_MS, 5 * 60 * 60 * 1000);
  assert.equal(DEFAULT_SANDBOX_TIMEOUT_MS, MAX_SANDBOX_TIMEOUT_MS);
});

test("formatEnvVars round-trips multiline and whitespace-sensitive values", async () => {
  const { formatEnvVars, parseEnvVarsText } = await loadRepoSettings();
  const input = {
    MULTILINE: "line one\nline two",
    PADDED: "  surrounded by spaces  ",
    PLAIN: "https://auth.creditrenew.com",
    SINGLE_QUOTE: "it's fine",
    EMPTY: "",
  };

  assert.deepEqual(parseEnvVarsText(formatEnvVars(input)), input);
});

test("formatEnvVars normalizes legacy quoted values before serializing", async () => {
  const { formatEnvVars } = await loadRepoSettings();

  assert.equal(
    formatEnvVars({
      AUTH_URL: '"https://auth.creditrenew.com"',
      MULTILINE: String.raw`"line one\nline two"`,
    }),
    [
      "AUTH_URL=https://auth.creditrenew.com",
      String.raw`MULTILINE="line one\nline two"`,
    ].join("\n")
  );
});

test("buildRuntimeSandboxEnv normalizes stored quoted env vars before launch", async () => {
  const { buildRuntimeSandboxEnv } = await loadRepoSettings();

  assert.deepEqual(
    buildRuntimeSandboxEnv(
      {
        AUTH_URL: '"https://auth.creditrenew.com"',
        API_TOKEN: "'secret-token'",
      },
      "sandbox-and-preview",
      "https://example-preview.vercel.app"
    ),
    {
      AUTH_URL: "https://auth.creditrenew.com",
      API_TOKEN: "secret-token",
      VERCEL: "1",
      VERCEL_ENV: "preview",
      VERCEL_TARGET_ENV: "preview",
      NEXT_PUBLIC_VERCEL_ENV: "preview",
      NEXT_PUBLIC_APP_URL: "https://example-preview.vercel.app",
      NEXT_PUBLIC_SITE_URL: "https://example-preview.vercel.app",
      VERCEL_URL: "example-preview.vercel.app",
      NEXT_PUBLIC_VERCEL_URL: "example-preview.vercel.app",
    }
  );
});

test("parseEnvVarsText keeps mismatched or interior quotes untouched and unwraps empty quoted strings", async () => {
  const { parseEnvVarsText } = await loadRepoSettings();

  assert.deepEqual(
    parseEnvVarsText(
      ["MISMATCHED=\"value'", 'EMPTY=""', "INTERIOR=it's fine"].join("\n")
    ),
    {
      MISMATCHED: `"value'`,
      EMPTY: "",
      INTERIOR: "it's fine",
    }
  );
});

test("resolveEffectiveSandboxTimeoutMs prefers repo override, then workspace default, then app default", async () => {
  const { DEFAULT_SANDBOX_TIMEOUT_MS, resolveEffectiveSandboxTimeoutMs } =
    await loadRepoSettings();

  assert.equal(
    resolveEffectiveSandboxTimeoutMs({
      repoTimeoutMs: 30 * 60 * 1000,
      workspaceTimeoutMs: 45 * 60 * 1000,
    }),
    30 * 60 * 1000
  );
  assert.equal(
    resolveEffectiveSandboxTimeoutMs({
      repoTimeoutMs: null,
      workspaceTimeoutMs: 45 * 60 * 1000,
    }),
    45 * 60 * 1000
  );
  assert.equal(
    resolveEffectiveSandboxTimeoutMs({
      repoTimeoutMs: null,
      workspaceTimeoutMs: null,
    }),
    DEFAULT_SANDBOX_TIMEOUT_MS
  );
});

test("normalizeSandboxIdleTimeoutMs clamps to the 5-minute floor and the lifetime ceiling", async () => {
  const {
    DEFAULT_SANDBOX_IDLE_TIMEOUT_MS,
    MAX_SANDBOX_TIMEOUT_MS,
    MIN_SANDBOX_IDLE_TIMEOUT_MS,
    normalizeSandboxIdleTimeoutMs,
  } = await loadRepoSettings();

  assert.equal(
    normalizeSandboxIdleTimeoutMs("not-a-number"),
    DEFAULT_SANDBOX_IDLE_TIMEOUT_MS
  );
  assert.equal(
    normalizeSandboxIdleTimeoutMs(1000),
    MIN_SANDBOX_IDLE_TIMEOUT_MS
  );
  assert.equal(
    normalizeSandboxIdleTimeoutMs(MAX_SANDBOX_TIMEOUT_MS + 60_000),
    MAX_SANDBOX_TIMEOUT_MS
  );
});

test("resolveEffectiveSandboxIdleTimeoutMs prefers repo, then workspace, then default, and caps at lifetime", async () => {
  const {
    DEFAULT_SANDBOX_IDLE_TIMEOUT_MS,
    resolveEffectiveSandboxIdleTimeoutMs,
  } = await loadRepoSettings();

  assert.equal(
    resolveEffectiveSandboxIdleTimeoutMs({
      repoIdleTimeoutMs: 45 * 60 * 1000,
      workspaceIdleTimeoutMs: 90 * 60 * 1000,
    }),
    45 * 60 * 1000
  );
  assert.equal(
    resolveEffectiveSandboxIdleTimeoutMs({
      repoIdleTimeoutMs: null,
      workspaceIdleTimeoutMs: 90 * 60 * 1000,
    }),
    90 * 60 * 1000
  );
  assert.equal(
    resolveEffectiveSandboxIdleTimeoutMs({
      repoIdleTimeoutMs: null,
      workspaceIdleTimeoutMs: null,
    }),
    DEFAULT_SANDBOX_IDLE_TIMEOUT_MS
  );
  // Idle value larger than lifetime gets clamped down
  assert.equal(
    resolveEffectiveSandboxIdleTimeoutMs({
      repoIdleTimeoutMs: 120 * 60 * 1000,
      workspaceIdleTimeoutMs: null,
      lifetimeTimeoutMs: 30 * 60 * 1000,
    }),
    30 * 60 * 1000
  );
});

test("resolveSandboxRootDirectory: undefined sandbox field falls back to repo default", async () => {
  const { resolveSandboxRootDirectory } = await loadRepoSettings();
  assert.equal(
    resolveSandboxRootDirectory({}, { root_directory: "packages/api" }),
    "packages/api"
  );
  assert.equal(resolveSandboxRootDirectory({}, { root_directory: null }), null);
  // Both sandbox and repo with explicitly-undefined fields collapse to
  // null (= repo root). Pins the legacy-record case where neither side
  // has a recorded path independently from the (null, null) test below.
  assert.equal(resolveSandboxRootDirectory({}, {}), null);
  assert.equal(resolveSandboxRootDirectory(null, null), null);
  // Null sandbox + non-null repo default: the case that the
  // SandboxHealthPanel hits while loading (current = null until the
  // record arrives). Must return the repo default — same shape as
  // sandbox === undefined — so the panel doesn't briefly show "/" and
  // then flip to the actual path on hydration.
  assert.equal(
    resolveSandboxRootDirectory(null, { root_directory: "packages/api" }),
    "packages/api"
  );
});

test("resolveSandboxRootDirectory: null sandbox field is an explicit repo-root override", async () => {
  const { resolveSandboxRootDirectory } = await loadRepoSettings();
  // Even when the repo has a non-null default, an explicit-null sandbox
  // launch must NOT collapse back to that default.
  assert.equal(
    resolveSandboxRootDirectory(
      { root_directory: null },
      { root_directory: "packages/api" }
    ),
    null
  );
});

test("resolveSandboxRootDirectory: string sandbox field is used verbatim and normalized", async () => {
  const { resolveSandboxRootDirectory } = await loadRepoSettings();
  assert.equal(
    resolveSandboxRootDirectory(
      { root_directory: "apps/admin" },
      { root_directory: "packages/api" }
    ),
    "apps/admin"
  );
  // Trailing slashes are normalized.
  assert.equal(
    resolveSandboxRootDirectory({ root_directory: "/apps/admin/" }, null),
    "apps/admin"
  );
  // '.' collapses to repo root.
  assert.equal(
    resolveSandboxRootDirectory(
      { root_directory: "." },
      { root_directory: "packages/api" }
    ),
    null
  );
});

test("hasConfiguredSandboxEnv: empty manual + non-vercel mode is false", async () => {
  const { hasConfiguredSandboxEnv } = await loadRepoSettings();
  assert.equal(
    hasConfiguredSandboxEnv({
      sandbox_env_vars: {},
      env_sync_mode: "sandbox-only",
      vercel_project_id: null,
    }),
    false
  );
});

test("hasConfiguredSandboxEnv: non-empty manual env vars is true", async () => {
  const { hasConfiguredSandboxEnv } = await loadRepoSettings();
  assert.equal(
    hasConfiguredSandboxEnv({
      sandbox_env_vars: { DATABASE_URL: "postgres://x" },
      env_sync_mode: "sandbox-only",
      vercel_project_id: null,
    }),
    true
  );
  // Whitespace-only keys are stripped by normalizeEnvVars, so a record
  // that only contains a blank key counts as empty.
  assert.equal(
    hasConfiguredSandboxEnv({
      sandbox_env_vars: { "   ": "value" },
      env_sync_mode: "sandbox-only",
      vercel_project_id: null,
    }),
    false
  );
});

test("hasConfiguredSandboxEnv: vercel-project mode requires a linked project id", async () => {
  const { hasConfiguredSandboxEnv } = await loadRepoSettings();
  assert.equal(
    hasConfiguredSandboxEnv({
      sandbox_env_vars: {},
      env_sync_mode: "vercel-project",
      vercel_project_id: "prj_123",
    }),
    true
  );
  assert.equal(
    hasConfiguredSandboxEnv({
      sandbox_env_vars: {},
      env_sync_mode: "vercel-project",
      vercel_project_id: null,
    }),
    false
  );
});
