import assert from "node:assert/strict";
import { test } from "vitest";
import {
  listGithubSshSigningKeys,
  registerGithubSshSigningKey,
} from "./github";

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
    {
      request: (url, init) =>
        init?.method === "POST"
          ? fake.request(url, init)
          : Promise.resolve(
              new Response(
                JSON.stringify([
                  { id: 7, key: "ssh-ed25519 AAAA different-comment" },
                ]),
                { status: 200 }
              )
            ),
    }
  );

  assert.deepEqual(result, { status: "already_registered", keyId: "7" });
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

test("GitHub validation failures must not be reported as registered keys", async () => {
  const fake = fakeRequest({
    status: 422,
    body: {
      message: "Validation Failed",
      errors: [{ message: "key is invalid" }],
    },
  });
  const result = await registerGithubSshSigningKey(
    { token: "gh-token", publicKey: "ssh-ed25519 invalid", title: "Mogplex" },
    { request: fake.request }
  );
  assert.equal(result.status, "failed");
});

test("a refused registration keeps the GitHub message", async () => {
  const fake = fakeRequest({ status: 500, body: { message: "Server Error" } });
  const result = await registerGithubSshSigningKey(
    { token: "gh-token", publicKey: "ssh-ed25519 AAAA", title: "Mogplex" },
    { request: fake.request }
  );

  assert.deepEqual(result, {
    status: "failed",
    message: "Server Error",
    httpStatus: 500,
  });
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

  assert.deepEqual(keys, [
    { id: "7", title: "Mogplex commit signing", publicKey: null },
  ]);
});

test("listing fails soft when GitHub refuses", async () => {
  const fake = fakeRequest({ status: 403, body: { message: "nope" } });
  const keys = await listGithubSshSigningKeys("gh-token", {
    request: fake.request,
  });

  assert.deepEqual(keys, []);
});

test("duplicate lookup follows pagination and verifies the exact signing key", async () => {
  const requests: string[] = [];
  const result = await registerGithubSshSigningKey(
    {
      token: "fixture-token",
      publicKey: "ssh-ed25519 TARGET local-comment",
      title: "Signing",
    },
    {
      request: async (url, init) => {
        requests.push(url);
        if (init?.method === "POST")
          return Response.json(
            { message: "Validation Failed" },
            { status: 422 }
          );
        if (new URL(url).searchParams.get("page") === "1")
          return Response.json(
            Array.from({ length: 100 }, (_, id) => ({
              id,
              key: `ssh-ed25519 OTHER${id}`,
            }))
          );
        return Response.json([
          { id: 101, key: "ssh-ed25519 TARGET github-comment" },
        ]);
      },
    }
  );
  assert.deepEqual(result, { status: "already_registered", keyId: "101" });
  assert.equal(requests.length, 3);
});

test("a duplicate rejection for a key absent from signing keys stays a failure", async () => {
  const result = await registerGithubSshSigningKey(
    {
      token: "fixture-token",
      publicKey: "ssh-ed25519 TARGET",
      title: "Signing",
    },
    {
      request: async (_url, init) =>
        init?.method === "POST"
          ? Response.json({ message: "key is already in use" }, { status: 422 })
          : Response.json([{ id: 1, key: "ssh-ed25519 DIFFERENT" }]),
    }
  );
  assert.deepEqual(result, {
    status: "failed",
    message: "key is already in use",
    httpStatus: 422,
  });
});
