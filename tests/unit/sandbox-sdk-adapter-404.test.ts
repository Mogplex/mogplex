import assert from "node:assert/strict";
import test from "node:test";
import { APIError } from "@vercel/sandbox";

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

function sandboxApiError({
  status = 404,
  code = "not_found",
  sandboxName = "sandbox-runtime-123",
}: {
  status?: number;
  code?: string;
  sandboxName?: string;
} = {}) {
  return new APIError(
    new Response(JSON.stringify({ error: { code } }), {
      status,
      statusText: status === 404 ? "Not Found" : "Provider error",
    }),
    {
      message: `Status code ${status} is not ok`,
      json: { error: { code } },
      sandboxName,
    }
  );
}

test("isSandboxLookupNotFoundError matches only an SDK lookup 404 for the requested sandbox", async () => {
  const { isSandboxLookupNotFoundError } = await loadAdapter();

  assert.equal(
    isSandboxLookupNotFoundError(sandboxApiError(), "sandbox-runtime-123"),
    true
  );
  assert.equal(
    isSandboxLookupNotFoundError(
      sandboxApiError({ sandboxName: "sandbox%2Fruntime" }),
      "sandbox/runtime"
    ),
    true
  );
});

test("isSandboxLookupNotFoundError rejects generic and mismatched 404 errors", async () => {
  const { isSandboxLookupNotFoundError } = await loadAdapter();

  assert.equal(
    isSandboxLookupNotFoundError(
      Object.assign(new Error("Project not found"), { status: 404 }),
      "sandbox-runtime-123"
    ),
    false
  );
  assert.equal(
    isSandboxLookupNotFoundError(
      sandboxApiError({ code: "project_not_found" }),
      "sandbox-runtime-123"
    ),
    false
  );
  assert.equal(
    isSandboxLookupNotFoundError(
      sandboxApiError({ sandboxName: "other-sandbox" }),
      "sandbox-runtime-123"
    ),
    false
  );
  assert.equal(
    isSandboxLookupNotFoundError(
      sandboxApiError({ status: 500 }),
      "sandbox-runtime-123"
    ),
    false
  );
});
