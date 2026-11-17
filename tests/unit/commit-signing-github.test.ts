import assert from "node:assert/strict";
import test from "node:test";
import {
  listGithubSshSigningKeys,
  registerGithubSshSigningKey,
} from "../../lib/commit-signing/github";

type Call = { url: string; init?: RequestInit };

function fakeRequest(response: { status: number; body?: unknown }) {
  const calls: Call[] = [];
  const request = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(response.body ?? {}), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { calls, request };
}

test("a new signing key is registered with GitHub", async () => {
  const fake = fakeRequest({
    status: 201,
    body: { id: 42, key: "ssh-ed25519 AAAA" },
  });
  const result = await registerGithubSshSigningKey(
    {
      token: "gh-token",
      publicKey: "ssh-ed25519 AAAA comment",
      title: "Mogplex commit signing",
    },
    { request: fake.request }
  );

  assert.deepEqual(result, { status: "registered", keyId: "42" });
  assert.equal(fake.calls.length, 1);
  assert.equal(
    fake.calls[0]?.url,
    "https://api.github.com/user/ssh_signing_keys"
  );
  assert.equal(fake.calls[0]?.init?.method, "POST");
  const body = JSON.parse(String(fake.calls[0]?.init?.body)) as {
    key: string;
    title: string;
  };
  assert.equal(body.key, "ssh-ed25519 AAAA comment");
  assert.equal(body.title, "Mogplex commit signing");
  const headers = fake.calls[0]?.init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer gh-token");
});

test("a key that is already registered is a success", async () => {
  const fake = fakeRequest({
    status: 422,
    body: {
      message: "Validation Failed",
      errors: [{ message: "key is already in use" }],
    },
  });
  const result = await registerGithubSshSigningKey(
    { token: "gh-token", publicKey: "ssh-ed25519 AAAA", title: "Mogplex" },
    { request: fake.request }
  );

  assert.deepEqual(result, { status: "already_registered", keyId: null });
});

test("a token without the signing key scope is reported", async () => {
  const fake = fakeRequest({
    status: 403,
    body: { message: "Resource not accessible" },
  });
  const result = await registerGithubSshSigningKey(
    { token: "gh-token", publicKey: "ssh-ed25519 AAAA", title: "Mogplex" },
    { request: fake.request }
  );

  assert.deepEqual(result, { status: "scope_missing" });
});

test("a refused registration keeps the GitHub message", async () => {
  const fake = fakeRequest({ status: 500, body: { message: "Server Error" } });
  const result = await registerGithubSshSigningKey(
    { token: "gh-token", publicKey: "ssh-ed25519 AAAA", title: "Mogplex" },
    { request: fake.request }
  );

  assert.deepEqual(result, { status: "failed", message: "Server Error" });
});

test("a network failure is reported instead of thrown", async () => {
  const result = await registerGithubSshSigningKey(
    { token: "gh-token", publicKey: "ssh-ed25519 AAAA", title: "Mogplex" },
    {
      request: async () => {
        throw new Error("network down");
      },
    }
  );

  assert.equal(result.status, "failed");
});

test("the registered signing keys can be listed", async () => {
  const fake = fakeRequest({
    status: 200,
    body: [{ id: 7, title: "Mogplex commit signing" }],
  });
  const keys = await listGithubSshSigningKeys("gh-token", {
    request: fake.request,
  });

  assert.deepEqual(keys, [{ id: "7", title: "Mogplex commit signing" }]);
});

test("listing fails soft when GitHub refuses", async () => {
  const fake = fakeRequest({ status: 403, body: { message: "nope" } });
  const keys = await listGithubSshSigningKeys("gh-token", {
    request: fake.request,
  });

  assert.deepEqual(keys, []);
});
