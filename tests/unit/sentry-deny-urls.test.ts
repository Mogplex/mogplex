import assert from "node:assert/strict";
import test from "node:test";
import { SENTRY_DENY_URLS } from "@/lib/observability/sentry-deny-urls";

function matchesAny(url: string): boolean {
  return SENTRY_DENY_URLS.some((pattern) => pattern.test(url));
}

test("SENTRY_DENY_URLS drops third-party gadstat.com frames", () => {
  // The originating frame on the Sentry issue lives at the gadstat.com
  // host — confirm denyUrls catches the realistic shape of that URL.
  assert.equal(matchesAny("https://gadstat.com/track/postUserData.js"), true);
  assert.equal(matchesAny("https://www.gadstat.com/v2/x.js"), true);
  // The deny pattern is host-substring based, so it matches regardless of
  // protocol — including legacy http:// frames that browser extensions
  // sometimes inject. The string is a fixture, not a live URL.
  // eslint-disable-next-line sonarjs/no-clear-text-protocols -- test fixture
  assert.equal(matchesAny("http://gadstat.com/x"), true);
});

test("SENTRY_DENY_URLS does not drop our own domain frames", () => {
  // Defense against an over-broad pattern accidentally swallowing our own
  // errors. Add cases here whenever a new entry is added.
  assert.equal(matchesAny("https://www.mogplex.com/_next/static/x.js"), false);
  assert.equal(matchesAny("https://localhost:3000/_next/static/x.js"), false);
  assert.equal(
    matchesAny("https://mogplex.vercel.app/_next/static/x.js"),
    false
  );
});

test("SENTRY_DENY_URLS does not drop look-alike domains that merely contain 'gadstat.com'", () => {
  // The deny pattern must be anchored on the host boundary so it cannot
  // match an unrelated domain that happens to embed the substring — that
  // would silently drop legitimate Sentry events.
  assert.equal(matchesAny("https://notgadstat.com/track.js"), false);
  assert.equal(matchesAny("https://gadstat.com.attacker.tld/track.js"), false);
  // Path-segment look-alikes must also be rejected — only the host portion
  // should drive the match.
  assert.equal(matchesAny("https://example.com/gadstat.com/index.js"), false);
});
