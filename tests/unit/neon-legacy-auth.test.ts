import assert from "node:assert/strict";
import test from "node:test";

process.env.MOGPLEX_DATA_BACKEND = "neon";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
process.env.APP_URL = "http://localhost:3000";
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_SECRET_KEY;

test("legacy GitHub entry points preserve safe next paths without touching Supabase", async () => {
  const login = await import("../../app/api/auth/login/github/route");
  const callback = await import("../../app/auth/callback/route");
  for (const handler of [login.GET, callback.GET]) {
    const response = await handler(
      new Request(
        "http://localhost:3000/auth/callback?code=old&next=%2Finvite%2Fexample"
      )
    );
    assert.equal(response.status, 307);
    assert.equal(
      response.headers.get("location"),
      "http://localhost:3000/login?next=%2Finvite%2Fexample"
    );
    const unsafe = await handler(
      new Request(
        "http://localhost:3000/auth/callback?next=https://evil.example"
      )
    );
    assert.equal(
      new URL(unsafe.headers.get("location")!).searchParams.get("next"),
      "/"
    );
  }
});

test("retired OAuth decisions fail closed in Neon mode and preserve origin checks", async () => {
  const { POST } = await import("../../app/api/oauth/decision/route");
  const makeRequest = (origin: string) =>
    new Request("http://localhost:3000/api/oauth/decision", {
      method: "POST",
      headers: { origin, "content-type": "application/x-www-form-urlencoded" },
      body: "authorization_id=11111111-1111-4111-8111-111111111111&decision=approve",
    });
  assert.equal((await POST(makeRequest("https://evil.example"))).status, 403);
  const response = await POST(makeRequest("http://localhost:3000"));
  assert.equal(response.status, 410);
  assert.equal((await response.json()).error, "authorization_flow_retired");
});

test("retired waitlist validation cannot consume codes or mint cookies in Neon mode", async () => {
  const { POST } = await import("../../app/api/auth/waitlist/validate/route");
  const response = await POST(
    new Request("http://localhost:3000/api/auth/waitlist/validate", {
      method: "POST",
      body: JSON.stringify({ code: "unused-code" }),
    })
  );
  assert.equal(response.status, 410);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal((await response.json()).error, "legacy_login_retired");
});
