import { describe, expect, it } from "vitest";
import {
  DEFAULT_SANDBOX_TIMEOUT_MS,
  MIN_SANDBOX_TIMEOUT_MS,
  normalizeSandboxTimeoutMs,
  resolveSandboxPath,
} from "./repo-settings";

describe("resolveSandboxPath", () => {
  it("keeps relative files inside an absolute worktree checkout", () => {
    expect(
      resolveSandboxPath(
        "/vercel/sandbox/.worktrees/11111111-2222-4333-8444-555555555555///",
        "./.mcp/config.json"
      )
    ).toBe(
      "/vercel/sandbox/.worktrees/11111111-2222-4333-8444-555555555555/.mcp/config.json"
    );
  });
});

describe("sandbox timeout defaults", () => {
  it.each([undefined, null, "", "   ", "invalid"])(
    "uses the default when no numeric timeout was supplied: %s",
    (value) => {
      expect(normalizeSandboxTimeoutMs(value)).toBe(DEFAULT_SANDBOX_TIMEOUT_MS);
    }
  );

  it("preserves explicit supported values and existing numeric clamping", () => {
    expect(normalizeSandboxTimeoutMs(600_000)).toBe(600_000);
    expect(normalizeSandboxTimeoutMs("1200000")).toBe(1_200_000);
    expect(normalizeSandboxTimeoutMs(0)).toBe(MIN_SANDBOX_TIMEOUT_MS);
  });
});
