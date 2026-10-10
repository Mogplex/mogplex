import { describe, expect, it } from "vitest";
import { FlowServiceError } from "@/lib/flows/errors";
import {
  modelAllowlistUnavailableError,
  MODEL_ALLOWLIST_UNAVAILABLE_ERROR,
} from "@/lib/team-capabilities";
import { mogplexAutomationErrorResponse } from "./automation-response";
import { MogplexApiAutomationError } from "./automations.types";

it("recognizes a wrapped allowlist outage before mapping permanent flow errors", async () => {
  const error = new FlowServiceError(
    "FLOW_GRAPH_INVALID",
    "private diagnostic",
    {
      cause: modelAllowlistUnavailableError(),
    }
  );
  const response = mogplexAutomationErrorResponse(error, "Could not publish");
  expect(response.status).toBe(503);
  expect(response.headers.get("retry-after")).toBe("5");
  expect(await response.json()).toEqual({
    ok: false,
    error: {
      code: "SERVICE_UNAVAILABLE",
      message: MODEL_ALLOWLIST_UNAVAILABLE_ERROR,
    },
  });
});

it("does not reclassify a real graph error as a transient outage", async () => {
  const response = mogplexAutomationErrorResponse(
    new FlowServiceError("FLOW_GRAPH_INVALID", "Missing start node"),
    "Could not publish"
  );
  expect(response.status).toBe(400);
  expect(response.headers.get("retry-after")).toBeNull();
  expect(await response.json()).toEqual({
    ok: false,
    error: { code: "BAD_REQUEST", message: "Missing start node" },
  });
});

it("keeps unknown failures sanitized instead of offering an authorization fallback", async () => {
  const response = mogplexAutomationErrorResponse(
    new Error("private storage diagnostic"),
    "Could not publish"
  );
  expect(response.status).toBe(500);
  expect(response.headers.get("retry-after")).toBeNull();
  expect(await response.json()).toEqual({
    ok: false,
    error: { code: "INTERNAL_ERROR", message: "Could not publish" },
  });
});

describe("mogplexAutomationErrorResponse", () => {
  it.each([
    ["AUTOMATION_NOT_INTEGRATION_ENABLED", 403, "AUTOMATION_REQUIRED"],
    ["IDEMPOTENCY_CONFLICT", 409, "IDEMPOTENCY_CONFLICT"],
    ["REPO_NOT_ALLOWED", 403, "FORBIDDEN"],
    ["AUTOMATION_NOT_FOUND", 404, "NOT_FOUND"],
    ["AUTOMATION_INACTIVE", 409, "CONFLICT"],
    ["INVALID_INPUT", 400, "BAD_REQUEST"],
  ] as const)("should report %s as %i %s", async (code, status, apiCode) => {
    const response = mogplexAutomationErrorResponse(
      new MogplexApiAutomationError(code, "message", status),
      "fallback"
    );
    expect(response.status).toBe(status);
    expect((await response.json()).error).toEqual({
      code: apiCode,
      message: "message",
    });
  });
});
