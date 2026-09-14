export const SCHEMA_DRIFT_CODE = "SCHEMA_DRIFT";
export const SCHEMA_DRIFT_MESSAGE =
  "The service could not finish this action. Keep this tab open and try again shortly.";

const schemaErrorCodes = new Set([
  SCHEMA_DRIFT_CODE,
  "42P01", // undefined_table
  "42703", // undefined_column
  "42883", // undefined_function
  "PGRST200", // missing relationship
  "PGRST202", // missing function/signature
  "PGRST204", // missing column
  "PGRST205", // missing table
]);

export function isSchemaDriftError(error: unknown): boolean {
  if (typeof error === "string") return error.includes(SCHEMA_DRIFT_MESSAGE);
  if (!error || typeof error !== "object") return false;
  const value = error as Record<string, unknown>;
  return (
    (typeof value.code === "string" && schemaErrorCodes.has(value.code)) ||
    (typeof value.message === "string" &&
      value.message.includes(SCHEMA_DRIFT_MESSAGE)) ||
    (typeof value.error === "string" &&
      value.error.includes(SCHEMA_DRIFT_MESSAGE))
  );
}

export class DatabaseSchemaError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
    this.name = "DatabaseSchemaError";
  }
}
