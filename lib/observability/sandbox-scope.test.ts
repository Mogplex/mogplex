import { expect, it } from "vitest";
import { callSandboxRecordId, sandboxCallsFilter } from "./sandbox-scope";

it("resolves native and harness IDs without replacing an explicit binding", () => {
  const native = "00000000-0000-4000-8000-000000000001";
  expect(callSandboxRecordId({ sandbox_id: native })).toBe(native);
  expect(sandboxCallsFilter(native)).toContain(
    `metadata->>sandbox_id.eq.${native}`
  );
  expect(() => sandboxCallsFilter("bad,id")).toThrow(
    "Invalid sandbox record ID"
  );
  expect(
    callSandboxRecordId({ sandbox_record_id: "record", sandbox_id: "provider" })
  ).toBe("record");
  for (const metadata of [
    null,
    [],
    {},
    { sandbox_id: 3 },
    { sandbox_id: "provider-id" },
    { sandbox_record_id: " " },
  ])
    expect(callSandboxRecordId(metadata)).toBeNull();
});
