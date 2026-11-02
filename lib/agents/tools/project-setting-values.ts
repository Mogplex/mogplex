import { z } from "zod";
import { REDACTED_VALUE, redactSecretsInText } from "@/lib/ai-telemetry";
import { normalizeEnvVars } from "@/lib/repo-settings";
import { ENV_NAME, isLoaderEnvName } from "./project-env-names";

/**
 * How Control's project tools show saved values and validate new ones.
 * Commands read back through project_settings have inline credentials
 * replaced by the redaction marker; saving one back would break every later
 * boot, so the save tools refuse the marker.
 */

/** A saved command as Control may see it; the row keeps the real text. */
export function shownCommand(command: string | null) {
  return command === null ? null : redactSecretsInText(command);
}

export const notRedacted = (value: string) => !value.includes(REDACTED_VALUE);

export const savedCommand = z
  .string()
  .refine(
    (value) => value.trim() !== "",
    "Empty. Use null to restore detection."
  )
  .refine(notRedacted, {
    message: `Contains ${REDACTED_VALUE} from a read-back value. Omit the field, or write the command out in full.`,
  });

// Narrower than SENSITIVE_KEY_TERMS in lib/ai-telemetry.ts on purpose: the
// redactor hides anything that might be a secret in free text, while this
// decides which setup variables Control may not save at all.
// Name segments that mark a variable as a secret, matched as whole
// `_`-separated parts so SESSION_TTL or MAX_TOKENS stay ordinary. These mark
// a secret anywhere (SECRET_KEY_BASE); TOKEN and KEY only as the last part
// (GITHUB_TOKEN, STRIPE_KEY, but not TOKEN_REFRESH_INTERVAL).
const SECRET_SEGMENTS = new Set([
  "CREDENTIAL",
  "CREDENTIALS",
  "PASSWD",
  "PASSWORD",
  "SECRET",
]);
const SECRET_LAST_SEGMENTS = new Set(["APIKEY", "KEY", "TOKEN"]);

/** Whether a variable name says it holds a secret. */
export function isSecretEnvName(name: string) {
  const segments = name.toUpperCase().split("_").filter(Boolean);
  const last = segments.at(-1) ?? "";
  return (
    SECRET_LAST_SEGMENTS.has(last) ||
    segments.some((segment) => SECRET_SEGMENTS.has(segment))
  );
}

/**
 * Why Control can't save (or, with null, delete) this variable, or null.
 * Secrets go through the operator's Project settings, never through the
 * model, so a secret-named variable is refused either way, and so is a value
 * the redactor would hide (a token shape, a URL with a password).
 */
export function envValueProblem(name: string, value: string | null) {
  if (isSecretEnvName(name)) {
    return value === null
      ? `${name} may hold a secret. Ask the operator to remove it in Project settings.`
      : `${name} looks like a secret. Ask the operator to add it in Project settings.`;
  }
  if (value === null) return null;
  // Check the value as it will be stored: one quote pair stripped, escapes
  // expanded. A spaces-only value is refused like a spaces-only command.
  const stored = normalizeEnvVars({ [name]: value })[name] ?? "";
  if (!stored.trim()) {
    return "The value is empty or only spaces once its surrounding quotes are removed. Use value: null to delete a variable.";
  }
  if (redactSecretsInText(stored) !== stored) {
    return `${name} looks like a secret. Ask the operator to add it in Project settings.`;
  }
  return null;
}

/** Why Control can't write this variable name and value, or null. */
export function envWriteProblem(name: string, value: string | null) {
  if (!ENV_NAME.test(name) || name === "__proto__") {
    return `${name || "That"} is not a valid variable name.`;
  }
  if (isLoaderEnvName(name)) {
    return `${name} changes how every program in the sandbox starts. Ask the operator to set it in Project settings.`;
  }
  return envValueProblem(name, value);
}

/**
 * Columns a settings update must still match to write: the ones it writes,
 * plus the pinned port when it clears the pin, since clearing depends on it.
 */
export function comparedSettingColumns(updates: Record<string, unknown>) {
  const columns = Object.keys(updates);
  if (updates.dev_port_auto === true && !("dev_port" in updates))
    columns.push("dev_port");
  return columns;
}
