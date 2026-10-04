import { z } from "zod";
import {
  ConnectionValidationError,
  normalizeConnectionCreateInput,
  normalizeConnectionSettingsPatch,
} from "@/lib/connections/validation";

// Reuse the existing preset, URL, credential and settings contracts.
// Only input-validation errors become Zod issues; operational errors still
// reach the route's existing failure handling.
function normalizedSchema<T>(normalize: (input: unknown) => T) {
  return z.unknown().transform((input, context) => {
    try {
      return normalize(input);
    } catch (error) {
      if (!(error instanceof ConnectionValidationError)) throw error;
      context.addIssue({ code: z.ZodIssueCode.custom, message: error.message });
      return z.NEVER;
    }
  });
}

export const connectionCreateSchema = normalizedSchema(
  normalizeConnectionCreateInput
);
export const connectionSettingsSchema = normalizedSchema(
  normalizeConnectionSettingsPatch
);
export const connectionIdSchema = z.object({ id: z.string().uuid() });
