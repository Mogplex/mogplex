import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildHarnessResearchEnv,
  isActiveResearchRun,
  verifyResearchToken,
  type ResearchClaims,
} from "./research-auth";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("run scoped research authorization", () => {
  const claims: ResearchClaims = {
    purpose: "harness-web-research",
    userId: "user-1",
    aiCallId: "call-1",
    sandboxRecordId: "sandbox-1",
    expiresAt: Date.now() + 10000,
  };
  const run = {
    id: "call-1",
    user_id: "user-1",
    status: "streaming" as const,
    control_state: "active" as const,
    cancel_requested_at: null,
    metadata: { sandbox_record_id: "sandbox-1" },
  };

  it("permits the active owner run and denies other users, sandboxes, or finished runs", () => {
    expect(isActiveResearchRun(run, claims)).toBe(true);
    expect(isActiveResearchRun(null, claims)).toBe(false);
    for (const change of [
      { user_id: "other" },
      { id: "other" },
      { metadata: { sandbox_record_id: "other" } },
      { status: "success" as const },
      { status: "failed" as const },
      { status: "cancelled" as const },
      { control_state: "cancel_requested" as const },
      { cancel_requested_at: "2026-09-21" },
    ]) {
      expect(isActiveResearchRun({ ...run, ...change }, claims)).toBe(false);
    }
  });

  it("expires tokens and rejects them after a signing secret change", () => {
    vi.stubEnv("EXA_API_KEY", "private-exa");
    vi.stubEnv("EXA_RESEARCH_SECRET", "first-secret");
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    const token = buildHarnessResearchEnv({
      userId: "user-1",
      aiCallId: "call-1",
      id: "sandbox-1",
    }).MOGPLEX_RESEARCH_TOKEN;
    expect(verifyResearchToken(token)?.userId).toBe("user-1");
    vi.spyOn(Date, "now").mockReturnValue(now + 24 * 60 * 60 * 1000);
    expect(verifyResearchToken(token)).toBe(null);
    vi.spyOn(Date, "now").mockReturnValue(now);
    vi.stubEnv("EXA_RESEARCH_SECRET", "different-secret");
    expect(verifyResearchToken(token)).toBe(null);
  });

  it.each([null, undefined, {}])(
    "denies a run with missing sandbox metadata: %s",
    (metadata) => {
      // Persisted data can violate the non-null application model.
      const malformedRun = { ...run, metadata } as unknown as Parameters<
        typeof isActiveResearchRun
      >[0];
      expect(isActiveResearchRun(malformedRun, claims)).toBe(false);
    }
  );
});
