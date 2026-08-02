import assert from "node:assert/strict";
import test from "node:test";

async function loadAdapter() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/sandbox/sdk-adapter");
}

test("sdk-adapter exports the persistent-aware wrapper surface", async () => {
  const adapter = await loadAdapter();
  assert.equal(typeof adapter.getSandboxByName, "function");
  assert.equal(typeof adapter.resumeSandboxByName, "function");
  assert.equal(typeof adapter.listSandboxesForCredentials, "function");
  assert.equal(typeof adapter.createPersistentSandboxForRepo, "function");
  assert.equal(typeof adapter.createPersistentSandboxFromSnapshot, "function");
  assert.equal(typeof adapter.captureSandboxSnapshot, "function");
  assert.equal(typeof adapter.extendSandboxLifetime, "function");
});
