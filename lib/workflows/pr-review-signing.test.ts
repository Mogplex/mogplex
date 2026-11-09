import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPrReviewSigner,
  readPrReviewSigningSecret,
} from "./pr-review-signing";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createPrReviewSigner", () => {
  const scope = { repoFullName: "Acme/Widgets", prNumber: 7 };

  it("should verify its own signature and nothing else", () => {
    const signer = createPrReviewSigner("secret", scope);
    const signature = signer.sign("finding:abc");

    expect(signature).toHaveLength(22);
    expect(signer.verify("finding:abc", signature)).toBe(true);
    expect(signer.verify("finding:abd", signature)).toBe(false);
    expect(signer.verify("finding:abc", signature.slice(0, 21))).toBe(false);
  });

  it("should bind signatures to the repository regardless of case", () => {
    const signature = createPrReviewSigner("secret", scope).sign("v");

    expect(
      createPrReviewSigner("secret", {
        ...scope,
        repoFullName: "acme/widgets",
      }).verify("v", signature)
    ).toBe(true);
    expect(
      createPrReviewSigner("secret", {
        ...scope,
        repoFullName: "acme/gadgets",
      }).verify("v", signature)
    ).toBe(false);
  });
});

describe("readPrReviewSigningSecret", () => {
  it("should read the GitHub App private key and treat a blank one as missing", () => {
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "  key  ");
    expect(readPrReviewSigningSecret()).toBe("key");

    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "   ");
    expect(readPrReviewSigningSecret()).toBeNull();
  });
});
