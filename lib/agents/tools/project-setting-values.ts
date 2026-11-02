import { z } from "zod";
import { REDACTED_VALUE, redactSecretsInText } from "@/lib/ai-telemetry";
import { normalizeEnvVars } from "@/lib/repo-settings";

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

/**
 * Why a variable value can't be saved by Control, or null. Secrets go
 * through the operator's Project settings, never through the model, so a
 * value the redactor would hide (a token shape, a URL with a password, or any
 * value under a secret-sounding name) is refused.
 */
export function envValueProblem(name: string, value: string) {
  // Quotes are stripped on save, so '""' would store an empty variable; a
  // spaces-only value is refused the same way a spaces-only command is.
  if (!normalizeEnvVars({ [name]: value })[name]?.trim()) {
    return "The value is empty or only spaces once its surrounding quotes are removed. Use value: null to delete a variable.";
  }
  const assignment = `${name}=${value}`;
  if (redactSecretsInText(assignment) !== assignment) {
    return `${name} looks like a secret. Ask the operator to add it in Project settings.`;
  }
  return null;
}
