import assert from "node:assert/strict";
import test from "node:test";

async function loadClient() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/sandbox/client");
}

test("isPersistentSandboxPermissionError matches 403 status codes", async () => {
  const { isPersistentSandboxPermissionError } = await loadClient();
  assert.equal(
    isPersistentSandboxPermissionError({ status: 403, message: "anything" }),
    true
  );
  assert.equal(isPersistentSandboxPermissionError({ statusCode: 403 }), true);
});

test("isPersistentSandboxPermissionError matches persistent+permission message combos", async () => {
  const { isPersistentSandboxPermissionError } = await loadClient();
  const cases = [
    "Persistent sandboxes not enabled for this project",
    "Permission denied: persistent sandbox creation",
    "Persistent sandbox feature is forbidden on this plan",
    "persistent sandboxes: 403 not allowed",
  ];
  for (const message of cases) {
    assert.equal(
      isPersistentSandboxPermissionError(new Error(message)),
      true,
      `should match: ${message}`
    );
  }
});

test("isPersistentSandboxPermissionError rejects unrelated errors", async () => {
  const { isPersistentSandboxPermissionError } = await loadClient();
  const cases = [
    new Error("timeout"),
    new Error("quota exceeded"),
    new Error("persistent"), // no permission keyword
    new Error("permission denied"), // no persistent keyword
    { status: 500, message: "server error" },
    null,
    undefined,
    "string",
  ];
  for (const err of cases) {
    assert.equal(
      isPersistentSandboxPermissionError(err),
      false,
      `should not match: ${JSON.stringify(err)}`
    );
  }
});
