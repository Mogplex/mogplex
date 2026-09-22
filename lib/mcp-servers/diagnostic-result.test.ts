import { expect, it } from "vitest";
import {
  diagnosticMessages,
  diagnosticResultSchema,
} from "./diagnostic-result";

const timestamps = {
  checkedAt: "2026-09-22T00:00:00Z",
  serverUpdatedAt: "2026-09-22T00:00:00Z",
};
it("accepts known diagnostic outcomes and rejects malformed responses", () => {
  for (const code of Object.keys(diagnosticMessages))
    expect(
      diagnosticResultSchema.safeParse({ ...timestamps, status: "error", code })
        .success
    ).toBe(true);
  expect(
    diagnosticResultSchema.safeParse({
      ...timestamps,
      status: "success",
      enabled: true,
      tools: [{ name: "search", approval: "prompt" }],
    }).success
  ).toBe(true);
  for (const data of [
    null,
    {},
    { ...timestamps, status: "error", code: "raw-secret-message" },
    { ...timestamps, status: "success", enabled: true, tools: "all" },
    {
      ...timestamps,
      status: "success",
      enabled: true,
      tools: [{ name: "search", approval: "unknown" }],
    },
  ])
    expect(diagnosticResultSchema.safeParse(data).success).toBe(false);
});
