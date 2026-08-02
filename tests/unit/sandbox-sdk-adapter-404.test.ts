import assert from "node:assert/strict";
import test from "node:test";

async function loadAdapter() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/sandbox/sdk-adapter");
}

test("isNotFoundError matches status 404", async () => {
  const { isNotFoundError } = await loadAdapter();
  assert.equal(isNotFoundError({ status: 404 }), true);
  assert.equal(isNotFoundError({ statusCode: 404 }), true);
});

test("isNotFoundError matches messages mentioning 'not found' or 'does not exist'", async () => {
  const { isNotFoundError } = await loadAdapter();
  for (const message of [
    "Sandbox not found",
    "No such sandbox: vm_abc",
    "The requested sandbox does not exist",
    "HTTP 404 returned from API",
  ]) {
    assert.equal(
      isNotFoundError(new Error(message)),
      true,
      `should match: ${message}`
    );
  }
});

test("isNotFoundError rejects unrelated errors", async () => {
  const { isNotFoundError } = await loadAdapter();
  for (const err of [
    new Error("permission denied"),
    new Error("timeout"),
    { status: 500, message: "server error" },
    null,
    undefined,
    "string",
  ]) {
    assert.equal(
      isNotFoundError(err),
      false,
      `should not match: ${JSON.stringify(err)}`
    );
  }
});
