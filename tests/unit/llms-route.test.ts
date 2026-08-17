import assert from "node:assert/strict";
import test from "node:test";
import { isPublicRoutePath } from "../../lib/auth-route-policy";
import { buildLlmsTxt } from "../../lib/llms-txt";
import { absoluteUrl } from "../../lib/seo";

test("llms.txt content follows the root markdown overview shape", () => {
  const text = buildLlmsTxt();

  assert.match(text, /^# Mogplex\n\n>/);
  assert.match(text, /## Public pages/);
  assert.match(text, /## Documentation and source/);
  assert.match(text, /## Policies/);
  assert.match(text, /Individual plans by Concurrency, retained data/);
  assert.match(text, /confirm an Individual plan/);
  assert.match(text, new RegExp(absoluteUrl("/").replace(/\//g, "\\/")));
  assert.match(text, /https:\/\/docs\.mogplex\.com\//);
});

test("GET /llms.txt serves text/plain and is proxy-public", async () => {
  const { GET } = await import("../../app/llms.txt/route");
  const response = GET();

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/plain; charset=utf-8/
  );
  assert.equal(await response.text(), buildLlmsTxt());
  assert.equal(isPublicRoutePath("/llms.txt"), true);
  assert.equal(isPublicRoutePath("/llms.txt/more"), false);
});
