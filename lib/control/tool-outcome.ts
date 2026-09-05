/** A delivered tool result is not necessarily a successful operation. */
export function controlToolOutcome(
  state: string,
  output?: unknown
): "running" | "done" | "failed" {
  if (state === "output-error" || state === "output-denied") return "failed";
  if (state !== "output-available") return "running";
  const result =
    output && typeof output === "object"
      ? (output as Record<string, unknown>)
      : {};
  const exitCode = result.exitCode ?? result.exit_code;
  if (
    result.status === "error" ||
    result.status === "failed" ||
    result.success === false ||
    result.ok === false ||
    (typeof result.error === "string" && result.error.trim().length > 0) ||
    (typeof exitCode === "number" && exitCode !== 0)
  )
    return "failed";
  if (result.status === "pending" || result.status === "starting")
    return "running";
  return "done";
}
