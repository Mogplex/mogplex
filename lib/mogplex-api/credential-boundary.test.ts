import { describe, expect, it } from "vitest";
import {
  isAutomationOnly,
  readStoredApiKeyAccess,
  requireFullAccessKey,
} from "./credential-boundary";

const login = { credentialKind: "interactive", keyAccess: null } as const;
const fullKey = { credentialKind: "integration", keyAccess: "full" } as const;
const automationsKey = {
  credentialKind: "integration",
  keyAccess: "automations",
} as const;

describe("isAutomationOnly", () => {
  it("should never restrict an interactive login, whatever the team allows", () => {
    expect(isAutomationOnly(login, "automations")).toBe(false);
  });

  it("should restrict a key its owner set to automations", () => {
    expect(isAutomationOnly(automationsKey)).toBe(true);
  });

  it("should let a full-access key act where its team allows full access", () => {
    expect(isAutomationOnly(fullKey, "full")).toBe(false);
    expect(isAutomationOnly(fullKey, null)).toBe(false);
  });

  it("should restrict a full-access key on a team that holds keys to automations", () => {
    expect(isAutomationOnly(fullKey, "automations")).toBe(true);
  });
});

describe("requireFullAccessKey", () => {
  it("should let an interactive login and a full-access key through", () => {
    expect(requireFullAccessKey(login)).toBeNull();
    expect(requireFullAccessKey(fullKey)).toBeNull();
  });

  it("should refuse an automations-only key with the automation-required error", async () => {
    const response = requireFullAccessKey(automationsKey);
    expect(response?.status).toBe(403);
    const body = await response?.json();
    expect(body.error.code).toBe("AUTOMATION_REQUIRED");
    expect(body.error.message).toMatch(/Automations only/);
    expect(body.error.message).toMatch(
      /automations\/\{automationId\}\/trigger/
    );
  });
});

describe("readStoredApiKeyAccess", () => {
  it("should read a missing value as full access, as every key had before", () => {
    expect(readStoredApiKeyAccess(undefined)).toBe("full");
    expect(readStoredApiKeyAccess(null)).toBe("full");
  });

  it("should read an unexpected value as the restrictive level", () => {
    expect(readStoredApiKeyAccess("admin")).toBe("automations");
  });

  it("should keep the stored levels", () => {
    expect(readStoredApiKeyAccess("full")).toBe("full");
    expect(readStoredApiKeyAccess("automations")).toBe("automations");
  });
});
