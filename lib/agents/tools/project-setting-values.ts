import { z } from "zod";
import { REDACTED_VALUE, redactSecretsInText } from "@/lib/ai-telemetry";

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
