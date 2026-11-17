import { CommitSigningEncryptionError } from "./secret-box";

const SAFE_CODES = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EACCES",
  "EPERM",
  "ENOENT",
  "42501",
  "42883",
  "42P01",
  "PGRST202",
]);

/** Never copy provider messages: file-operation errors can contain private keys. */
export function signingFailureDiagnostic(error: unknown) {
  let status: number | undefined;
  let code: string | undefined;
  let exitCode: number | undefined;
  let encryption = false;
  const seen = new Set<object>();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    encryption ||= current instanceof CommitSigningEncryptionError;
    const fields = current as Record<string, unknown>;
    const candidate = fields.status ?? fields.statusCode;
    if (
      status === undefined &&
      typeof candidate === "number" &&
      Number.isInteger(candidate) &&
      candidate >= 100 &&
      candidate <= 599
    )
      status = candidate;
    if (
      code === undefined &&
      typeof fields.code === "string" &&
      SAFE_CODES.has(fields.code)
    )
      code = fields.code;
    if (
      exitCode === undefined &&
      typeof fields.exitCode === "number" &&
      Number.isInteger(fields.exitCode) &&
      fields.exitCode >= 0 &&
      fields.exitCode <= 255
    )
      exitCode = fields.exitCode;
    current = fields.cause;
  }
  const category = encryption
    ? "encryption"
    : ["42883", "42P01", "PGRST202"].includes(code ?? "")
      ? "configuration"
      : code === "ETIMEDOUT" || status === 408 || status === 504
        ? "timeout"
        : status === 401 ||
            status === 403 ||
            ["EACCES", "EPERM", "42501"].includes(code ?? "")
          ? "authorization"
          : status === 404 || code === "ENOENT"
            ? "not_found"
            : status === 429
              ? "rate_limited"
              : (status !== undefined && status >= 500) ||
                  ["ECONNRESET", "ECONNREFUSED", "ENOTFOUND"].includes(
                    code ?? ""
                  )
                ? "unavailable"
                : exitCode === undefined
                  ? "unknown"
                  : "command_failed";
  return {
    category,
    ...(status === undefined ? {} : { status }),
    ...(code ? { code } : {}),
    ...(exitCode === undefined ? {} : { exitCode }),
  };
}
