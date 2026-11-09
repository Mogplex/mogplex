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
 * the repo and PR can: a forged or copied marker fails to verify and is read
 * as absent.
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
 * build-time import never freezes an empty value.
 */
export function readPrReviewSigningSecret(): string | null {
  const secret = process.env.GITHUB_APP_PRIVATE_KEY?.trim();
  return secret ? secret : null;
}
