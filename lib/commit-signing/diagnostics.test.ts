import { expect, test } from "vitest";
import { signingFailureDiagnostic } from "./diagnostics";

test.each([
  [{ status: 401 }, { category: "authorization", status: 401 }],
  [{ status: 403 }, { category: "authorization", status: 403 }],
  [{ status: 404 }, { category: "not_found", status: 404 }],
  [{ status: 429 }, { category: "rate_limited", status: 429 }],
  [{ status: 503 }, { category: "unavailable", status: 503 }],
  [{ status: 504 }, { category: "timeout", status: 504 }],
  [{ code: "ETIMEDOUT" }, { category: "timeout", code: "ETIMEDOUT" }],
  [{ code: "ECONNRESET" }, { category: "unavailable", code: "ECONNRESET" }],
  [{ code: "EACCES" }, { category: "authorization", code: "EACCES" }],
  [{ code: "ENOENT" }, { category: "not_found", code: "ENOENT" }],
  [null, { category: "unknown" }],
  ["secret", { category: "unknown" }],
  [
    {
      code: "private-key",
      status: 700,
      message: "secret",
      cause: "secret",
      stack: "secret",
    },
    { category: "unknown" },
  ],
])("retains only safe diagnostic fields for %j", (input, expected) => {
  expect(signingFailureDiagnostic(input)).toEqual(expected);
});
