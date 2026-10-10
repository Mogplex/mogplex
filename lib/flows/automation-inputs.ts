/**
 * Input contract for automations started by an integration (start event
 * `api`). The automation declares its fields; a caller may supply values for
 * those fields only. Inputs are data for the workflow, never a replacement for
 * its instructions, repository or execution settings, so unknown keys are
 * rejected rather than ignored.
 */

export type AutomationInputFieldType =
  | "string"
  | "integer"
  | "boolean"
  | "json";

export type AutomationInputField = {
  key: string;
  type: AutomationInputFieldType;
  required?: boolean;
  description?: string;
  /** `string` only. Defaults to {@link DEFAULT_STRING_MAX_LENGTH}. */
  maxLength?: number;
  /** `string` only. Matched against the whole value. */
  pattern?: string;
  /** `string` only. The value must be one of these. */
  enum?: string[];
  /** `json` only. Serialized size cap. Defaults to {@link DEFAULT_JSON_MAX_BYTES}. */
  maxBytes?: number;
};

export type AutomationInputValidation =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; errors: string[] };

const FIELD_TYPES: ReadonlySet<string> = new Set([
  "string",
  "integer",
  "boolean",
  "json",
]);
const KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
export const MAX_INPUT_FIELDS = 32;
const DEFAULT_STRING_MAX_LENGTH = 2_000;
const MAX_STRING_MAX_LENGTH = 100_000;
const DEFAULT_JSON_MAX_BYTES = 64 * 1024;
const MAX_JSON_MAX_BYTES = 256 * 1024;
export const MAX_TOTAL_INPUT_BYTES = 512 * 1024;
const MAX_PATTERN_LENGTH = 200;
const MAX_ENUM_VALUES = 50;
const MAX_DESCRIPTION_LENGTH = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedInteger(value: unknown, max: number) {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= max
    ? value
    : undefined;
}

function compilePattern(pattern: string) {
  try {
    return new RegExp(`^(?:${pattern})$`, "u");
  } catch {
    return null;
  }
}

function coerceStringField(record: Record<string, unknown>) {
  const maxLength = boundedInteger(record.maxLength, MAX_STRING_MAX_LENGTH);
  const pattern =
    typeof record.pattern === "string" && record.pattern.trim()
      ? record.pattern.trim().slice(0, MAX_PATTERN_LENGTH)
      : undefined;
  const values = Array.isArray(record.enum)
    ? record.enum
        .filter((value): value is string => typeof value === "string")
        .slice(0, MAX_ENUM_VALUES)
    : [];
  return {
    ...(maxLength ? { maxLength } : {}),
    ...(pattern ? { pattern } : {}),
    ...(values.length > 0 ? { enum: values } : {}),
  };
}

/** Keeps only well-formed field definitions; used when coercing graph JSON. */
export function coerceAutomationInputFields(
  raw: unknown
): AutomationInputField[] {
  if (!Array.isArray(raw)) return [];
  const fields: AutomationInputField[] = [];
  for (const entry of raw.slice(0, MAX_INPUT_FIELDS)) {
    if (!isRecord(entry)) continue;
    const key = typeof entry.key === "string" ? entry.key.trim() : "";
    const type = typeof entry.type === "string" ? entry.type : "";
    if (!key || !FIELD_TYPES.has(type)) continue;
    const description =
      typeof entry.description === "string" && entry.description.trim()
        ? entry.description.trim().slice(0, MAX_DESCRIPTION_LENGTH)
        : undefined;
    const maxBytes =
      type === "json"
        ? boundedInteger(entry.maxBytes, MAX_JSON_MAX_BYTES)
        : undefined;
    fields.push({
      key,
      type: type as AutomationInputFieldType,
      ...(entry.required === true ? { required: true } : {}),
      ...(description ? { description } : {}),
      ...(type === "string" ? coerceStringField(entry) : {}),
      ...(maxBytes ? { maxBytes } : {}),
    });
  }
  return fields;
}

/** Errors in the declared contract itself, reported when publishing. */
export function validateAutomationInputFields(
  fields: readonly AutomationInputField[]
): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const field of fields) {
    if (!KEY_PATTERN.test(field.key)) {
      errors.push(
        `Input "${field.key}" must be lowercase letters, digits or underscores, starting with a letter.`
      );
    }
    if (seen.has(field.key)) {
      errors.push(`Input "${field.key}" is declared more than once.`);
    }
    seen.add(field.key);
    if (field.pattern && !compilePattern(field.pattern)) {
      errors.push(`Input "${field.key}" has an invalid pattern.`);
    }
  }
  return errors;
}

function jsonSize(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function validateString(field: AutomationInputField, value: unknown) {
  if (typeof value !== "string")
    return `Input "${field.key}" must be a string.`;
  const maxLength = field.maxLength ?? DEFAULT_STRING_MAX_LENGTH;
  if (value.length > maxLength) {
    return `Input "${field.key}" must be at most ${maxLength} characters.`;
  }
  if (field.enum && !field.enum.includes(value)) {
    return `Input "${field.key}" must be one of: ${field.enum.join(", ")}.`;
  }
  if (field.pattern && !compilePattern(field.pattern)?.test(value)) {
    return `Input "${field.key}" does not match the required format.`;
  }
  return null;
}

function validateValue(field: AutomationInputField, value: unknown) {
  switch (field.type) {
    case "string":
      return validateString(field, value);
    case "integer":
      return typeof value === "number" && Number.isSafeInteger(value)
        ? null
        : `Input "${field.key}" must be an integer.`;
    case "boolean":
      return typeof value === "boolean"
        ? null
        : `Input "${field.key}" must be true or false.`;
    case "json": {
      const maxBytes = field.maxBytes ?? DEFAULT_JSON_MAX_BYTES;
      return value !== undefined && jsonSize(value) <= maxBytes
        ? null
        : `Input "${field.key}" must be JSON of at most ${maxBytes} bytes.`;
    }
  }
}

/**
 * Checks caller input against the automation's declared fields. Returns the
 * accepted value with only declared keys, so nothing else can reach the run.
 */
export function validateAutomationInput(
  fields: readonly AutomationInputField[],
  input: unknown
): AutomationInputValidation {
  if (input !== undefined && !isRecord(input)) {
    return { ok: false, errors: ["input must be an object."] };
  }
  const supplied = input ?? {};
  const declared = new Map(fields.map((field) => [field.key, field]));
  const errors: string[] = [];

  const unknownKeys = Object.keys(supplied).filter((key) => !declared.has(key));
  if (unknownKeys.length > 0) {
    const accepted = fields.map((field) => field.key).join(", ") || "none";
    errors.push(
      `Unknown input ${unknownKeys.map((key) => `"${key}"`).join(", ")}. ` +
        `This automation accepts: ${accepted}. Inputs cannot replace the automation's instructions, repository or execution settings.`
    );
  }

  const value: Record<string, unknown> = {};
  for (const field of fields) {
    const fieldValue = supplied[field.key];
    if (fieldValue === undefined || fieldValue === null) {
      if (field.required) errors.push(`Input "${field.key}" is required.`);
      continue;
    }
    const error = validateValue(field, fieldValue);
    if (error) errors.push(error);
    else value[field.key] = fieldValue;
  }

  if (errors.length === 0 && jsonSize(value) > MAX_TOTAL_INPUT_BYTES) {
    errors.push(
      `input must be at most ${MAX_TOTAL_INPUT_BYTES} bytes in total.`
    );
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}

const SAMPLE_STRINGS = ["example", "example-1", "1", "a"];

function sampleValue(field: AutomationInputField) {
  switch (field.type) {
    case "integer":
      return 1;
    case "boolean":
      return false;
    case "json":
      return {};
    case "string":
      return [...(field.enum ?? []), ...SAMPLE_STRINGS].find(
        (candidate) => validateString(field, candidate) === null
      );
  }
}

/**
 * A starting test payload for the inspector, with a value for each field that
 * passes the field's own rules. When no sample fits, such as a strict pattern,
 * a required field is left empty for the author to fill in and an optional one
 * is left out, so it can't fail the test on its own.
 */
export function sampleAutomationInput(
  fields: readonly AutomationInputField[]
): Record<string, unknown> {
  const sample: Record<string, unknown> = {};
  for (const field of fields) {
    const value = sampleValue(field);
    if (value !== undefined) sample[field.key] = value;
    else if (field.required) sample[field.key] = "";
  }
  return sample;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : 1))
      .map(
        ([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`
      );
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

/**
 * Run metadata every API-triggered run records: the accepted input snapshot,
 * its hash (an idempotent replay must match it), and a branch derived from the
 * idempotency key so a retried run returns to the same branch.
 */
export async function buildApiRunInputMetadata(input: {
  scopedIdempotencyKey: string;
  value: Record<string, unknown>;
}) {
  const [inputHash, keyHash] = await Promise.all([
    sha256Hex(stableStringify(input.value)),
    sha256Hex(input.scopedIdempotencyKey),
  ]);
  return {
    input: input.value,
    input_hash: inputHash,
    working_branch: `mogplex/automation-${keyHash.slice(0, 16)}`,
  };
}
