import assert from "node:assert/strict";
import test from "node:test";
import { config as proxyConfig } from "../../proxy";
import {
  IMAGE_ASSET_SCOPE_EXTENSIONS,
  isImageAssetScopeSegment,
  parseScopeContextHeaders,
} from "../../lib/scope-context";

test("missing middleware scope headers can be treated as not found at the route boundary", () => {
  assert.equal(parseScopeContextHeaders(new Headers()), null);
});

test("scope headers parse personal and team contexts", () => {
  assert.deepEqual(
    parseScopeContextHeaders(
      new Headers({
        "x-mogplex-scope-kind": "personal",
        "x-mogplex-scope-slug": "alice",
        "x-mogplex-scope-id": "profile-alice",
      })
    ),
    {
      kind: "personal",
      slug: "alice",
      profileId: "profile-alice",
    }
  );

  assert.deepEqual(
    parseScopeContextHeaders(
      new Headers({
        "x-mogplex-scope-kind": "team",
        "x-mogplex-scope-slug": "acme",
        "x-mogplex-scope-id": "team-acme",
      })
    ),
    {
      kind: "team",
      slug: "acme",
      teamId: "team-acme",
    }
  );
});

test("an unknown scope kind remains a loud middleware contract failure", () => {
  assert.throws(
    () =>
      parseScopeContextHeaders(
        new Headers({
          "x-mogplex-scope-kind": "organization",
          "x-mogplex-scope-slug": "acme",
          "x-mogplex-scope-id": "org-acme",
        })
      ),
    /parseScopeContextHeaders: unknown scope kind "organization"/
  );
});

test("only image-like dynamic scope segments qualify for the missing-header 404 fallback", () => {
  for (const segment of [
    "og-image.png",
    "apple-touch-icon-precomposed.png",
    "logo.svg",
    "photo.JPEG",
  ]) {
    assert.equal(isImageAssetScopeSegment(segment), true);
  }

  for (const segment of ["alice", "team.example", "image.png/extra"]) {
    assert.equal(isImageAssetScopeSegment(segment), false);
  }
});

test("the missing-header 404 extensions stay aligned with image extensions bypassed by proxy", () => {
  const [matcher] = proxyConfig.matcher;
  const extensionGroup = matcher.match(/\.\*\\\.\(\?:([a-z|]+)\)\$/)?.[1];

  assert.ok(extensionGroup, "expected an image extension group in the matcher");
  assert.deepEqual(extensionGroup.split("|"), [
    ...IMAGE_ASSET_SCOPE_EXTENSIONS,
  ]);
});
