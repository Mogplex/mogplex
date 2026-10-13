import { describe, expect, it } from "vitest";
import {
  GITHUB_MANIFEST_STATE_TTL_SECONDS,
  signGithubManifestState,
  verifyGithubManifestState,
} from "./github-manifest-state";

const SECRET = "test-signing-secret-at-least-32-characters";
const NOW = 1_800_000_000;

describe("GitHub manifest state", () => {
  it("should accept a fresh state for the user who started setup", () => {
    const state = signGithubManifestState("user-1", SECRET, NOW);

    expect(verifyGithubManifestState(state, "user-1", SECRET, NOW + 30)).toBe(
      true
    );
  });

  it("should reject a state started by another user", () => {
    const state = signGithubManifestState("user-1", SECRET, NOW);

    expect(verifyGithubManifestState(state, "user-2", SECRET, NOW)).toBe(false);
  });

  it("should reject a state signed with another secret", () => {
    const state = signGithubManifestState("user-1", "another-secret", NOW);

    expect(verifyGithubManifestState(state, "user-1", SECRET, NOW)).toBe(false);
  });

  it("should reject a state after the code lifetime", () => {
    const state = signGithubManifestState("user-1", SECRET, NOW);
    const expired = NOW + GITHUB_MANIFEST_STATE_TTL_SECONDS + 1;

    expect(verifyGithubManifestState(state, "user-1", SECRET, expired)).toBe(
      false
    );
  });

  it("should reject a tampered payload", () => {
    const state = signGithubManifestState("user-1", SECRET, NOW);
    const [, mac] = state.split(".");
    const forgedBody = Buffer.from(
      JSON.stringify({ userId: "user-2", nonce: "n", ts: NOW })
    ).toString("base64url");

    expect(
      verifyGithubManifestState(`${forgedBody}.${mac}`, "user-2", SECRET, NOW)
    ).toBe(false);
  });

  it("should reject missing and malformed states", () => {
    expect(verifyGithubManifestState(undefined, "user-1", SECRET, NOW)).toBe(
      false
    );
    expect(verifyGithubManifestState("no-dot", "user-1", SECRET, NOW)).toBe(
      false
    );
    expect(verifyGithubManifestState(".mac", "user-1", SECRET, NOW)).toBe(
      false
    );
  });
});
