import assert from "node:assert/strict";
import test from "node:test";

async function loadClient() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/sandbox/client");
}

function withCleanEnv<T>(fn: () => T): T {
  const prevEnable = process.env.ENABLE_PERSISTENT_SANDBOXES;
  const prevDisable = process.env.DISABLE_PERSISTENT_SANDBOXES;
  delete process.env.ENABLE_PERSISTENT_SANDBOXES;
  delete process.env.DISABLE_PERSISTENT_SANDBOXES;
  try {
    return fn();
  } finally {
    if (prevEnable === undefined) {
      delete process.env.ENABLE_PERSISTENT_SANDBOXES;
    } else {
      process.env.ENABLE_PERSISTENT_SANDBOXES = prevEnable;
    }
    if (prevDisable === undefined) {
      delete process.env.DISABLE_PERSISTENT_SANDBOXES;
    } else {
      process.env.DISABLE_PERSISTENT_SANDBOXES = prevDisable;
    }
  }
}

test("persistent defaults to DISABLED when neither env var is set", async () => {
  const { persistentSandboxesDisabledByEnv } = await loadClient();
  await withCleanEnv(() => {
    assert.equal(persistentSandboxesDisabledByEnv(), true);
  });
});

test("ENABLE_PERSISTENT_SANDBOXES=true/1/yes/on opts in", async () => {
  const { persistentSandboxesDisabledByEnv } = await loadClient();
  await withCleanEnv(() => {
    for (const value of ["true", "TRUE", "1", "yes", "on", " true "]) {
      process.env.ENABLE_PERSISTENT_SANDBOXES = value;
      assert.equal(
        persistentSandboxesDisabledByEnv(),
        false,
        `expected ENABLE=${JSON.stringify(value)} to enable persistence`
      );
    }
  });
});

test("ENABLE_PERSISTENT_SANDBOXES=false/0/no/off/blank keeps the default-off", async () => {
  const { persistentSandboxesDisabledByEnv } = await loadClient();
  await withCleanEnv(() => {
    for (const value of ["false", "0", "no", "off", "", "anything-else"]) {
      process.env.ENABLE_PERSISTENT_SANDBOXES = value;
      assert.equal(
        persistentSandboxesDisabledByEnv(),
        true,
        `expected ENABLE=${JSON.stringify(value)} to leave persistence off`
      );
    }
  });
});

test("DISABLE_PERSISTENT_SANDBOXES=true forces off even when ENABLE is true", async () => {
  const { persistentSandboxesDisabledByEnv } = await loadClient();
  await withCleanEnv(() => {
    process.env.ENABLE_PERSISTENT_SANDBOXES = "true";
    process.env.DISABLE_PERSISTENT_SANDBOXES = "true";
    assert.equal(persistentSandboxesDisabledByEnv(), true);
  });
});

test("DISABLE_PERSISTENT_SANDBOXES=false is a no-op when ENABLE is unset (still off by default)", async () => {
  const { persistentSandboxesDisabledByEnv } = await loadClient();
  await withCleanEnv(() => {
    process.env.DISABLE_PERSISTENT_SANDBOXES = "false";
    assert.equal(persistentSandboxesDisabledByEnv(), true);
  });
});
