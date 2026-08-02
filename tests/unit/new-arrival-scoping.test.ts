import assert from "node:assert/strict";
import test from "node:test";
import {
  filterModelsToUsableScopes,
  isModelUsableInScope,
  type ModelUsabilityScope,
} from "../../lib/models/new-arrival-scoping";

const gatewayOnly = {
  hasGateway: true,
  hasOpenAi: false,
  hasAnthropic: false,
  hasOpenRouter: false,
};
const noAccess = {
  hasGateway: false,
  hasOpenAi: false,
  hasAnthropic: false,
  hasOpenRouter: false,
};

test("isModelUsableInScope requires both reachability and allowance", () => {
  const scope: ModelUsabilityScope = { access: gatewayOnly, allowlist: null };
  assert.equal(isModelUsableInScope("anthropic/x", scope), true);
  // Reachable but not on the allowlist.
  assert.equal(
    isModelUsableInScope("anthropic/x", {
      access: gatewayOnly,
      allowlist: new Set(["anthropic/y"]),
    }),
    false
  );
  // Allowed (null = unrestricted) but unreachable.
  assert.equal(
    isModelUsableInScope("openrouter/x", {
      access: gatewayOnly,
      allowlist: null,
    }),
    false
  );
});

test("filterModelsToUsableScopes keeps a model usable in any one scope", () => {
  const models = [
    { id: "anthropic/keep" },
    { id: "openrouter/keep" },
    { id: "openrouter/drop" },
  ];
  const scopes: ModelUsabilityScope[] = [
    // Personal: gateway only, unrestricted.
    { access: gatewayOnly, allowlist: null },
    // Team: adds OpenRouter, but only allows one of the two openrouter models.
    {
      access: { ...gatewayOnly, hasOpenRouter: true },
      allowlist: new Set(["openrouter/keep"]),
    },
  ];

  assert.deepEqual(
    filterModelsToUsableScopes(models, scopes).map((m) => m.id),
    ["anthropic/keep", "openrouter/keep"]
  );
});

test("filterModelsToUsableScopes drops everything when the only scope has no access", () => {
  const models = [{ id: "anthropic/x" }, { id: "openai/y" }];
  assert.deepEqual(
    filterModelsToUsableScopes(models, [{ access: noAccess, allowlist: null }]),
    []
  );
});

test("filterModelsToUsableScopes returns nothing when there are no scopes", () => {
  assert.deepEqual(filterModelsToUsableScopes([{ id: "anthropic/x" }], []), []);
});
