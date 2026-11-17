import { expect, test } from "vitest";
import { CommitSigningEncryptionError } from "./secret-box";
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

test("classifies nested network causes and safely terminates cyclic error chains", () => {
  const cause = { code: "ECONNRESET", message: "private-key-material" };
  expect(
    signingFailureDiagnostic(new TypeError("fetch failed", { cause }))
  ).toEqual({ category: "unavailable", code: "ECONNRESET" });
  const cyclic: { cause?: unknown; message: string } = {
    message: "private-key-material",
  };
  cyclic.cause = cyclic;
  expect(signingFailureDiagnostic(cyclic)).toEqual({ category: "unknown" });
  expect(signingFailureDiagnostic({ statusCode: 403 })).toEqual({
    category: "authorization",
    status: 403,
  });
  expect(signingFailureDiagnostic({ cause: { code: "42883" } })).toEqual({
    category: "configuration",
    code: "42883",
  });
  expect(signingFailureDiagnostic({ exitCode: 2 })).toEqual({
    category: "command_failed",
    exitCode: 2,
  });
});

test("encryption failures remain identifiable without copying their messages", () => {
  expect(
    signingFailureDiagnostic(
      new CommitSigningEncryptionError("private-key-material")
    )
  ).toEqual({ category: "encryption" });
});

test("permanent database schema and constraint errors remain actionable", () => {
  for (const code of ["42703", "PGRST116", "23505"])
    expect(signingFailureDiagnostic({ code })).toEqual({
      code,
      category: "configuration",
    });
});
