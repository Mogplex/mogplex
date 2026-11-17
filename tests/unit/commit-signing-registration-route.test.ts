import assert from "node:assert/strict";
import test from "node:test";
import { commitSigningFixture as fixture } from "../support/commit-signing-fixture";

function checkRequest() {
  return new Request("http://localhost/api", {
    method: "POST",
    body: JSON.stringify({ action: "check" }),
  });
}

test("checking registration recognizes a manually registered signing key", async () => {
  const { handlers, current } = fixture({
    checkKey: async () => ({ status: "registered", keyId: "manual-key" }),
  });
  await handlers.POST(
    new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({ action: "generate" }),
    })
  );
  const response = await handlers.POST(checkRequest());
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
  const body = await (await handlers.POST(checkRequest())).json();
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
  const body = await (await handlers.POST(checkRequest())).json();
  assert.equal(body.registrationStatus, "unavailable");
  assert.equal(body.githubKeyId, "99");
  assert.equal(current()?.githubKeyId, "99");
});

test("missing or unavailable GitHub credentials leave settings usable without guessing key registration", async () => {
  for (const [getGithubToken, status] of [
    [async () => null, "not_connected"],
    [
      async () => {
        throw new Error("private token error");
      },
      "unavailable",
    ],
  ] as const) {
    const { handlers } = fixture({ getGithubToken });
    await handlers.POST(
      new Request("http://localhost/api", {
        method: "POST",
        body: JSON.stringify({ action: "generate" }),
      })
    );
    const response = await handlers.POST(checkRequest());
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.configured, true);
    assert.equal(body.registrationStatus, status);
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
    const body = await (await handlers.POST(checkRequest())).json();
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

test("loading saved settings never waits for GitHub or writes a registration receipt", async () => {
  let checks = 0;
  const { handlers } = fixture({
    checkKey: async () => {
      checks++;
      return { status: "registered", keyId: "42" };
    },
  });
  await handlers.POST(
    new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({ action: "generate" }),
    })
  );
  const body = await (await handlers.GET()).json();
  assert.equal(body.configured, true);
  assert.equal(body.registered, false);
  assert.equal(checks, 0);
});

test("receipt persistence failures preserve the settings and report an unknown check", async () => {
  for (const removed of [false, true]) {
    let fail = false;
    const { handlers, current } = fixture({
      checkKey: async () => ({
        status: removed ? "not_registered" : "registered",
        keyId: "manual",
      }),
      markRegistered: async () => {
        if (fail) throw new Error("private database detail");
      },
      clearRegistration: async () => {
        throw new Error("private database detail");
      },
      loadKey: async () =>
        current()
          ? { ...current()!, registeredAt: removed ? "2026-01-01" : null }
          : null,
    });
    await handlers.POST(
      new Request("http://localhost/api", {
        method: "POST",
        body: JSON.stringify({ action: "generate" }),
      })
    );
    fail = true;
    const response = await handlers.POST(checkRequest());
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.configured, true);
    assert.equal(body.publicKey, current()?.publicKey);
    assert.equal(body.registrationStatus, "unavailable");
    assert.doesNotMatch(JSON.stringify(body), /private database detail/);
  }
});

test("rate-limited registration offers retry instead of claiming missing permissions", async () => {
  const { handlers } = fixture({
    registerKey: async () => ({ status: "rate_limited" }),
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
  assert.equal(body.retryable, true);
  assert.match(body.error, /try again later/i);
  assert.equal(body.manualRegistrationRequired, undefined);
});
