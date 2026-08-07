import { expect } from "@playwright/test";
import { buildE2EAuthHeaders } from "./auth";
import type { APIRequestContext } from "@playwright/test";

export const user1Headers = buildE2EAuthHeaders("user-1");
export const user2Headers = buildE2EAuthHeaders("user-2");

export type TestStateSeed = {
  installations?: Array<Record<string, unknown>>;
  agents?: Array<Record<string, unknown>>;
  flows?: Array<Record<string, unknown>>;
  flowVersions?: Array<Record<string, unknown>>;
  flowTemplates?: Array<Record<string, unknown>>;
  triggers?: Array<Record<string, unknown>>;
  jobRuns?: Array<Record<string, unknown>>;
  flowNodeRuns?: Array<Record<string, unknown>>;
  dispatchEvents?: Array<Record<string, unknown>>;
  aiCalls?: Array<Record<string, unknown>>;
  aiCallEvents?: Array<Record<string, unknown>>;
  assistant?: Record<string, unknown>;
  faults?: Record<string, unknown>;
};

export async function seedState(
  request: APIRequestContext,
  state: TestStateSeed
) {
  const response = await request.post("/api/test/e2e/flows", {
    headers: user1Headers,
    data: { state },
  });
  expect(response.ok()).toBeTruthy();
}

export async function resetState(request: APIRequestContext) {
  const response = await request.delete("/api/test/e2e/flows", {
    headers: user1Headers,
  });
  expect(response.ok()).toBeTruthy();
}

export async function getTestState(request: APIRequestContext) {
  const response = await request.get("/api/test/e2e/flows", {
    headers: user1Headers,
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}
