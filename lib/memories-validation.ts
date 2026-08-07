import { InvalidMetadataError } from "@/lib/memories-errors";

export const MAX_METADATA_BYTES = 4_096;

/**
 * Validate untrusted metadata before it reaches the DB. Accepts plain
 * objects only and bounds the serialised size. Throws InvalidMetadataError
 * on violation so API routes can map to 400 without leaking internals.
 */
export function validateMetadata(
  value: unknown
): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined;
  if (
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new InvalidMetadataError("metadata must be a plain object");
  }
  const serialised = JSON.stringify(value);
  if (serialised.length > MAX_METADATA_BYTES) {
    throw new InvalidMetadataError(
      `metadata exceeds ${MAX_METADATA_BYTES} bytes`
    );
  }
  return value as Record<string, unknown>;
}
