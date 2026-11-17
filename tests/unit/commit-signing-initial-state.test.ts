import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SWRConfig } from "swr";
import { CommitSigningSection } from "../../app/(dashboard)/[scope]/settings/_components/commit-signing-section";

test("an unchecked saved key never renders a claim of GitHub absence", () => {
  const html = renderToStaticMarkup(
    createElement(
      SWRConfig,
      {
        value: {
          provider: () => new Map(),
          fallback: {
            "/api/settings/commit-signing": {
              available: true,
              configured: true,
              registered: false,
              publicKey: "ssh-ed25519 saved-key",
              fingerprint: "SHA256:saved",
              title: null,
              registeredAt: null,
              githubKeyId: null,
              createdAt: null,
            },
          },
        },
      },
      createElement(CommitSigningSection)
    )
  );
  assert.match(html, /Checking GitHub registration/);
  assert.match(html, /ssh-ed25519 saved-key/);
  assert.doesNotMatch(html, /Not registered with GitHub/);
  assert.doesNotMatch(html, /Add this public key as a Signing Key on GitHub/);
});
