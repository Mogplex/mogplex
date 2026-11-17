/** Never copy provider messages: file-operation errors can contain private keys. */
export function signingFailureDiagnostic(error: unknown) {
  const fields =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  const status =
    typeof fields.status === "number" &&
    Number.isInteger(fields.status) &&
    fields.status >= 100 &&
    fields.status <= 599
      ? fields.status
      : undefined;
  const safeCodes = [
    "ETIMEDOUT",
    "ECONNRESET",
    "ECONNREFUSED",
    "ENOTFOUND",
    "EACCES",
    "EPERM",
    "ENOENT",
  ];
  const code =
    typeof fields.code === "string" && safeCodes.includes(fields.code)
      ? fields.code
      : undefined;
  const category =
    code === "ETIMEDOUT" || status === 408 || status === 504
      ? "timeout"
      : status === 401 ||
          status === 403 ||
          code === "EACCES" ||
          code === "EPERM"
        ? "authorization"
        : status === 404 || code === "ENOENT"
          ? "not_found"
          : status === 429
            ? "rate_limited"
            : (status !== undefined && status >= 500) ||
                code === "ECONNRESET" ||
                code === "ECONNREFUSED" ||
                code === "ENOTFOUND"
              ? "unavailable"
              : "unknown";
  return {
    category,
    ...(status === undefined ? {} : { status }),
    ...(code ? { code } : {}),
  };
}
