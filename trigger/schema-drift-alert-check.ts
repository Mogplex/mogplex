import { task } from "@trigger.dev/sdk/v3";
import { DatabaseSchemaError, SCHEMA_DRIFT_CODE } from "@/lib/schema-drift";

export async function raiseSchemaDriftAlertCheck(): Promise<never> {
  // Manual operator check: exercise the deployed failure hook without touching
  // the database or replaying a business operation. Failure is expected.
  throw new DatabaseSchemaError(
    "Synthetic schema alert check; no database was modified",
    SCHEMA_DRIFT_CODE
  );
}

export const schemaDriftAlertCheck = task({
  id: "verify-schema-drift-alert",
  // Prove the global schema hook stops retries even when a task allows them.
  retry: { maxAttempts: 3 },
  run: raiseSchemaDriftAlertCheck,
});
