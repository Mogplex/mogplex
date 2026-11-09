import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

const SIGNATURE_LENGTH = 22;

export type PrReviewSigner = {
  sign: (value: string) => string;
  verify: (value: string, signature: string) => boolean;
};

/**
 * Signs the hidden markers Mogplex leaves on a pull request. Anyone who can
 * comment on the PR can write a marker, and reviews may post with a user's
 * token, so the author cannot tell our markers apart. A signature bound to
 * the repo and PR can: a forged marker, or one copied from another repo or
 * PR, fails to verify and is read as absent. A copy within the same PR still
 * verifies; readers of the review state take the newest review time, so an
 * old copy cannot stand in for the latest review.
 */
export function createPrReviewSigner(
  secret: string,
  scope: { repoFullName: string; prNumber: number }
): PrReviewSigner {
  const key = Buffer.from(
    hkdfSync("sha256", secret, "", "mogplex-pr-review-markers", 32)
  );
  const bound = `${scope.repoFullName.toLowerCase()}#${scope.prNumber}`;
  const sign = (value: string) =>
    createHmac("sha256", key)
      .update(`${bound}\n${value}`)
      .digest("base64url")
      .slice(0, SIGNATURE_LENGTH);
  return {
    sign,
    verify: (value, signature) => {
      const expected = Buffer.from(sign(value));
      const actual = Buffer.from(signature);
      return (
        actual.length === expected.length && timingSafeEqual(actual, expected)
      );
    },
  };
}

/**
 * The marker key comes from the GitHub App private key, which every
 * deployment that reviews pull requests already has. Read per call so a
 * build-time import never freezes an empty value. Rotating that key resets
 * review memory: existing markers stop verifying, so the next review on each
 * PR is a first review and may post its findings inline again.
 */
export function readPrReviewSigningSecret(): string | null {
  const secret = process.env.GITHUB_APP_PRIVATE_KEY?.trim();
  return secret ? secret : null;
}
