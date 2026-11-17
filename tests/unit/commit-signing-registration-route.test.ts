import assert from "node:assert/strict";
import test from "node:test";
import { commitSigningFixture as fixture } from "../support/commit-signing-fixture";

test("loading settings recognizes a manually registered signing key", async () => {
  const { handlers, current } = fixture({
    checkKey: async () => ({ status: "registered", keyId: "manual-key" }),
  });
  await handlers.POST(
    new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({ action: "generate" }),
    })
  );
  const response = await handlers.GET();
  const body = await response.json();
  assert.equal(body.registered, true);
  assert.equal(body.registrationStatus, "registered");
  assert.equal(body.githubKeyId, "manual-key");
  assert.equal(current()?.githubKeyId, "manual-key");
  assert.doesNotMatch(JSON.stringify(body), /PRIVATE KEY/);
});

test("registering an existing GitHub key records it without another create request", async () => {
  const { handlers, registrations } = fixture({
    checkKey: async () => ({ status: "registered", keyId: "manual-key" }),
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
  assert.equal((await response.json()).githubKeyId, "manual-key");
  assert.equal(registrations.length, 0);
});

test("a confirmed GitHub removal clears the receipt but preserves the signing key", async () => {
  const { handlers, current } = fixture();
  for (const action of ["generate", "register"])
    await handlers.POST(
      new Request("http://localhost/api", {
        method: "POST",
        body: JSON.stringify({ action }),
      })
    );
  const publicKey = current()?.publicKey;
  const body = await (await handlers.GET()).json();
  assert.equal(body.registrationStatus, "not_registered");
  assert.equal(body.registered, false);
  assert.equal(body.githubKeyId, null);
  assert.equal(body.publicKey, publicKey);
  assert.equal(current()?.registeredAt, null);
});

test("a failed GitHub check preserves the last receipt without claiming current registration", async () => {
  const { handlers, current } = fixture({
    checkKey: async () => ({ status: "unavailable" }),
  });
  for (const action of ["generate", "register"])
    await handlers.POST(
      new Request("http://localhost/api", {
        method: "POST",
        body: JSON.stringify({ action }),
      })
    );
  const body = await (await handlers.GET()).json();
  assert.equal(body.registrationStatus, "unavailable");
  assert.equal(body.githubKeyId, "99");
  assert.equal(current()?.githubKeyId, "99");
});

test("missing or unavailable GitHub credentials leave settings usable without guessing key registration", async () => {
  for (const getGithubToken of [
    async () => null,
    async () => {
      throw new Error("private token error");
    },
  ]) {
    const { handlers } = fixture({ getGithubToken });
    await handlers.POST(
      new Request("http://localhost/api", {
        method: "POST",
        body: JSON.stringify({ action: "generate" }),
      })
    );
    const response = await handlers.GET();
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.configured, true);
    assert.equal(body.registrationStatus, "unavailable");
    assert.doesNotMatch(JSON.stringify(body), /private token error/);
  }
});

test("a delayed check does not certify a key replaced or deleted in another tab", async () => {
  for (const removed of [false, true]) {
    const { handlers } = fixture({
      checkKey: async () => {
        await (removed
          ? handlers.DELETE()
          : handlers.POST(
              new Request("http://localhost/api", {
                method: "POST",
                body: JSON.stringify({ action: "generate" }),
              })
            ));
        return { status: "registered", keyId: "old-key" };
      },
    });
    await handlers.POST(
      new Request("http://localhost/api", {
        method: "POST",
        body: JSON.stringify({ action: "generate" }),
      })
    );
    const body = await (await handlers.GET()).json();
    assert.equal(body.configured, !removed);
    assert.equal(body.registrationStatus, "unavailable");
    assert.equal(body.registered, false);
    assert.equal(body.githubKeyId, null);
  }
});

test("registration failures show an actionable message instead of upstream diagnostics", async () => {
  const { handlers } = fixture({
    registerKey: async () => ({
      status: "failed",
      message: "private upstream error",
    }),
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
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.match(body.error, /Try again or add the public key on GitHub/);
  assert.doesNotMatch(body.error, /private upstream error/);
});
