import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";
import { commitSigningFixture as fixture } from "../support/commit-signing-fixture";
import { generateCommitSigningKeyPair } from "../../lib/commit-signing/key-material";

test("a failed GitHub token lookup asks for retry without losing the saved key", async () => {
  const { handlers, registrations, current } = fixture({
    getGithubToken: async () => {
      throw Object.assign(new Error("private-token-store-detail"), {
        code: "ECONNRESET",
      });
    },
  });
  await handlers.POST(
    new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({ action: "generate" }),
    })
  );
  const publicKey = current()?.publicKey;
  const response = await handlers.POST(
    new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({ action: "register" }),
    })
  );
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.retryable, true);
  assert.equal(body.publicKey, publicKey);
  assert.equal(body.configured, true);
  assert.match(body.error, /try again/i);
  assert.equal(body.manualRegistrationRequired, undefined);
  assert.doesNotMatch(
    JSON.stringify(body),
    /private-token-store-detail|Connect your GitHub/
  );
  assert.equal(current()?.publicKey, publicKey);
  assert.equal(registrations.length, 0);
});

test("the settings screen sees that signing is not set up yet", async () => {
  const { handlers } = fixture();
  const response = await handlers.GET();
  const body = (await response.json()) as {
    available: boolean;
    configured: boolean;
    publicKey: string | null;
  };

  assert.equal(response.status, 200);
  assert.equal(body.available, true);
  assert.equal(body.configured, false);
  assert.equal(body.publicKey, null);
});

test("a deployment without the encryption secret reports signing as unavailable", async () => {
  const { handlers } = fixture({ isEncryptionConfigured: () => false });
  const response = await handlers.GET();

  assert.equal(response.status, 503);
  const body = (await response.json()) as { available: boolean };
  assert.equal(body.available, false);
});

test("generating a key stores it and returns the public key", async () => {
  const { handlers, saved } = fixture();
  const response = await handlers.POST(
    new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({ action: "generate" }),
    })
  );
  const body = (await response.json()) as {
    configured: boolean;
    publicKey: string;
  };

  assert.equal(response.status, 200);
  assert.equal(body.configured, true);
  assert.match(body.publicKey, /^ssh-ed25519 /);
  assert.equal(saved.length, 1);
  assert.match(saved[0]?.privateKey ?? "", /BEGIN OPENSSH PRIVATE KEY/);
});

test("registering the key with GitHub records the registration", async () => {
  const { handlers, registrations } = fixture();
  await handlers.POST(
    new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({ action: "generate" }),
    })
  );
  const response = await handlers.POST(
    new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({ action: "register" }),
    })
  );
  const body = (await response.json()) as { registered: boolean };

  assert.equal(response.status, 200);
  assert.equal(body.registered, true);
  assert.equal(registrations.length, 1);
  assert.match(registrations[0]?.publicKey ?? "", /^ssh-ed25519 /);
});

test("without a GitHub token the user is told to register the key by hand", async () => {
  const { handlers } = fixture({ getGithubToken: async () => null });
  await handlers.POST(
    new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({ action: "generate" }),
    })
  );
  const response = await handlers.POST(
    new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({ action: "register" }),
    })
  );
  const body = (await response.json()) as {
    manualRegistrationRequired: boolean;
    publicKey: string;
  };

  assert.equal(response.status, 409);
  assert.equal(body.manualRegistrationRequired, true);
  assert.match(body.publicKey, /^ssh-ed25519 /);
});

test("a token without the signing key scope points at the manual path", async () => {
  const { handlers } = fixture({
    registerKey: async () => ({ status: "scope_missing" }),
  });
  await handlers.POST(
    new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({ action: "generate" }),
    })
  );
  const response = await handlers.POST(
    new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({ action: "register" }),
    })
  );
  const body = (await response.json()) as {
    manualRegistrationRequired: boolean;
  };

  assert.equal(response.status, 409);
  assert.equal(body.manualRegistrationRequired, true);
});

test("importing a private key stores it", async () => {
  const { handlers, saved } = fixture();
  const pair = generateCommitSigningKeyPair();
  const response = await handlers.POST(
    new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({
        action: "import",
        privateKey: pair.privateKey,
      }),
    })
  );

  assert.equal(response.status, 200);
  assert.equal(saved.length, 1);
  assert.match(saved[0]?.privateKey ?? "", /BEGIN OPENSSH PRIVATE KEY/);
});

test("importing something that is not a key is rejected", async () => {
  const { handlers } = fixture();
  const response = await handlers.POST(
    new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({ action: "import", privateKey: "nope" }),
    })
  );

  assert.equal(response.status, 400);
});

test("revoking removes the stored key", async () => {
  const { handlers, deleted } = fixture();
  await handlers.POST(
    new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({ action: "generate" }),
    })
  );
  const response = await handlers.DELETE();
  const body = (await response.json()) as { configured: boolean };

  assert.equal(response.status, 200);
  assert.equal(body.configured, false);
  assert.deepEqual(deleted, ["user-1"]);
});

test("an unknown action is rejected", async () => {
  const { handlers } = fixture();
  const response = await handlers.POST(
    new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({ action: "nope" }),
    })
  );

  assert.equal(response.status, 400);
});

test("malformed field types are rejected before saving or registering a key", async () => {
  for (const body of [
    { action: "generate", title: 17 },
    { action: "import", privateKey: {} },
    { action: "generate", registerWithGithub: "false" },
  ]) {
    const { handlers, saved, registrations } = fixture();
    const response = await handlers.POST(
      new Request("http://localhost/api", {
        method: "POST",
        body: JSON.stringify(body),
      })
    );
    assert.equal(response.status, 400);
    assert.equal(saved.length, 0);
    assert.equal(registrations.length, 0);
  }
});

test("all signing settings operations require authentication", async () => {
  const { handlers, saved, deleted } = fixture({
    requireUserId: async () =>
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
  });
  assert.equal((await handlers.GET()).status, 401);
  assert.equal(
    (
      await handlers.POST(
        new Request("http://localhost/api", {
          method: "POST",
          body: JSON.stringify({ action: "generate" }),
        })
      )
    ).status,
    401
  );
  assert.equal((await handlers.DELETE()).status, 401);
  assert.equal(saved.length, 0);
  assert.equal(deleted.length, 0);
});

test("a delayed GitHub response cannot mark a replacement key registered", async () => {
  const create = () =>
    new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({ action: "generate" }),
    });
  const { handlers } = fixture({
    registerKey: async () => {
      await handlers.POST(create());
      return { status: "registered", keyId: "old-key-id" };
    },
  });
  await handlers.POST(create());
  const response = await handlers.POST(
    new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({ action: "register" }),
    })
  );
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /key changed/i);
});

test("token-store configuration failures preserve the key and point to support", async () => {
  const { handlers, current } = fixture({
    getGithubToken: async () => {
      throw new Error("sensitive rpc detail", { cause: { code: "42883" } });
    },
  });
  await handlers.POST(
    new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({ action: "generate" }),
    })
  );
  const response = await handlers.POST(
    new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({ action: "register" }),
    })
  );
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.retryable, false);
  assert.match(body.error, /Contact support/);
  assert.doesNotMatch(body.error, /sensitive|Connect your GitHub|try again/);
  assert.ok(current());
});
