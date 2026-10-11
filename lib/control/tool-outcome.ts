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
    (Array.isArray(result.failures) &&
      result.failures.some((code) => typeof code === "number" && code !== 0)) ||
    (typeof result.outputCheck === "string" && result.outputCheck.length > 0) ||
    (("exitCode" in result || "exit_code" in result) &&
      typeof exitCode !== "number") ||
    (typeof result.error === "string" && result.error.trim().length > 0) ||
    (typeof exitCode === "number" && exitCode !== 0)
  )
    return "failed";
  if (result.status === "pending" || result.status === "starting")
    return "running";
  return "done";
}

/** Keep exit evidence useful even when a command has no stderr (e.g. grep). */
export function controlToolFailureDetail(
  output?: Record<string, unknown> | null
): string {
  if (!output) return "The tool returned an error.";
  const exit = output.exitCode ?? output.exit_code;
  const failures = Array.isArray(output.failures)
    ? output.failures.filter((code) => typeof code === "number" && code !== 0)
    : [];
  return (
    [
      output.error,
      failures.length > 0
        ? `Shell steps exited with code ${failures.join(", ")}.`
        : typeof exit === "number"
          ? `Command exited with code ${exit}.`
          : "exitCode" in output
            ? "Command completion could not be confirmed."
            : null,
      output.outputCheck,
      output.stderr,
    ]
      .filter(
        (value): value is string =>
          typeof value === "string" && value.trim().length > 0
      )
      .join("\n") || "The tool returned an error."
  );
}
