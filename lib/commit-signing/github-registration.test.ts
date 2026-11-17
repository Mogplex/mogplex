import { expect, test } from "vitest";
import {
  checkGithubSshSigningKey,
  registerGithubSshSigningKey,
} from "./github";

const input = {
  token: "fixture-token",
  publicKey: "ssh-ed25519 TARGET local-comment",
};

test("recognizes a manually registered key on the authenticated account without a write scope", async () => {
  const result = await checkGithubSshSigningKey(input, {
    request: async (url, init) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        "Bearer fixture-token"
      );
      expect(init?.method).toBeUndefined();
      if (url === "https://api.github.com/user")
        return Response.json({ login: "current-account" });
      expect(url).toBe(
        "https://api.github.com/users/current-account/ssh_signing_keys?per_page=100&page=1"
      );
      return Response.json([
        { id: 42, key: "ssh-ed25519 TARGET github-comment" },
      ]);
    },
  });
  expect(result).toEqual({ status: "registered", keyId: "42" });
});

test("checks later pages and only accepts the exact signing key", async () => {
  const result = await checkGithubSshSigningKey(input, {
    request: async (url) => {
      if (url.endsWith("/user")) return Response.json({ login: "account" });
      if (url.endsWith("page=1"))
        return Response.json(
          Array.from({ length: 100 }, (_, id) => ({
            id,
            key: `ssh-ed25519 OTHER${id}`,
          }))
        );
      return Response.json([{ id: "101", key: "ssh-ed25519 TARGET" }]);
    },
  });
  expect(result).toEqual({ status: "registered", keyId: "101" });
});

test.each([
  { keys: [] },
  { keys: [{ id: 1, key: "ssh-ed25519 OTHER" }] },
  { keys: [{ id: 1, key: "ssh-rsa TARGET" }] },
])("a successful complete lookup can confirm absence: %j", async ({ keys }) => {
  expect(
    await checkGithubSshSigningKey(input, {
      request: async (url) =>
        Response.json(url.endsWith("/user") ? { login: "account" } : keys),
    })
  ).toEqual({ status: "not_registered" });
});

test.each([401, 403, 404, 429, 500])(
  "a refused public key lookup is unknown, not absence: %i",
  async (status) => {
    expect(
      await checkGithubSshSigningKey(input, {
        request: async (url) =>
          url.endsWith("/user")
            ? Response.json({ login: "account" })
            : new Response(null, { status }),
      })
    ).toEqual({ status: "unavailable" });
  }
);

test.each([
  null,
  {},
  { login: "" },
  { login: "../someone-else" },
  { login: 42 },
])("invalid account identity cannot certify a key: %j", async (account) => {
  expect(
    await checkGithubSshSigningKey(input, {
      request: async (url) => {
        expect(url).toBe("https://api.github.com/user");
        return Response.json(account);
      },
    })
  ).toEqual({ status: "unavailable" });
});

test.each(
  [null, {}, [null], [{ id: 1 }], [{ key: "ssh-ed25519 TARGET" }]].map(
    (keys) => ({ keys })
  )
)("malformed key lists are not evidence of removal: %j", async ({ keys }) => {
  expect(
    await checkGithubSshSigningKey(input, {
      request: async (url) =>
        Response.json(url.endsWith("/user") ? { login: "account" } : keys),
    })
  ).toEqual({ status: "unavailable" });
});

test("expired authentication, invalid JSON and network failures remain unknown", async () => {
  for (const request of [
    async () => new Response(null, { status: 401 }),
    async () => new Response("not JSON"),
    async () => {
      throw new Error("network unavailable");
    },
  ])
    expect(await checkGithubSshSigningKey(input, { request })).toEqual({
      status: "unavailable",
    });
});

test("GitHub hides missing signing-key write permissions behind a 404", async () => {
  expect(
    await registerGithubSshSigningKey(
      { ...input, title: "Signing" },
      {
        request: async () =>
          Response.json({ message: "Not Found" }, { status: 404 }),
      }
    )
  ).toEqual({ status: "scope_missing" });
});

test.each([
  {
    status: 403,
    headers: new Headers({ "x-ratelimit-remaining": "0" }),
    message: "API rate limit exceeded",
  },
  {
    status: 403,
    headers: new Headers({ "Retry-After": "60" }),
    message: "secondary rate limit",
  },
  {
    status: 403,
    headers: new Headers(),
    message: "You have exceeded a secondary rate limit",
  },
  { status: 429, headers: new Headers(), message: "Too many requests" },
])(
  "registration rate limits remain retryable: %j",
  async ({ status, headers, message }) => {
    expect(
      await registerGithubSshSigningKey(
        { ...input, title: "Signing" },
        {
          request: async () => Response.json({ message }, { status, headers }),
        }
      )
    ).toEqual({ status: "rate_limited" });
  }
);

test("SSO enforcement is not misreported as missing signing-key permissions", async () => {
  const result = await registerGithubSshSigningKey(
    { ...input, title: "Signing" },
    {
      request: async () =>
        Response.json(
          { message: "SSO required" },
          { status: 403, headers: { "x-github-sso": "required" } }
        ),
    }
  );
  expect(result.status).toBe("failed");
});
