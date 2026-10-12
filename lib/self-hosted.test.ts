import { describe, expect, it } from "vitest";
import { resolveSelfHostedMode, selfHostedModeGrants } from "./self-hosted";

function env(values: Record<string, string>): NodeJS.ProcessEnv {
  return values as NodeJS.ProcessEnv;
}

describe("self-host mode", () => {
  it("stays off when the flag is unset", () => {
    const mode = resolveSelfHostedMode(env({}));
    expect(mode.active).toBe(false);
    expect(selfHostedModeGrants(mode, "dev@example.com")).toBe(false);
  });

  it("grants every signed-in user when the flag is on", () => {
    const mode = resolveSelfHostedMode(env({ MOGPLEX_SELF_HOSTED: "1" }));
    expect(mode.active).toBe(true);
    expect(selfHostedModeGrants(mode, "dev@example.com")).toBe(true);
    expect(selfHostedModeGrants(mode, null)).toBe(true);
  });

  it("accepts true as the flag value", () => {
    expect(
      resolveSelfHostedMode(env({ MOGPLEX_SELF_HOSTED: "true" })).active
    ).toBe(true);
    expect(
      resolveSelfHostedMode(env({ MOGPLEX_SELF_HOSTED: "0" })).active
    ).toBe(false);
  });

  it("limits the grant to allowed email domains when configured", () => {
    const mode = resolveSelfHostedMode(
      env({
        MOGPLEX_SELF_HOSTED: "1",
        MOGPLEX_SELF_HOSTED_ALLOWED_EMAIL_DOMAINS: "Example.com, @corp.dev",
      })
    );
    expect(selfHostedModeGrants(mode, "dev@example.com")).toBe(true);
    expect(selfHostedModeGrants(mode, "ops@CORP.dev")).toBe(true);
    expect(selfHostedModeGrants(mode, "someone@gmail.com")).toBe(false);
    expect(selfHostedModeGrants(mode, null)).toBe(false);
  });

  it("refuses to activate when Stripe billing is configured", () => {
    const mode = resolveSelfHostedMode(
      env({ MOGPLEX_SELF_HOSTED: "1", STRIPE_SECRET_KEY: "sk_live_x" })
    );
    expect(mode.active).toBe(false);
    expect(mode.refusedReason).toBe("stripe_configured");
    expect(selfHostedModeGrants(mode, "dev@example.com")).toBe(false);
  });
});
