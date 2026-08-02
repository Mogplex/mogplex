export const MAX_ORCHESTRATION_SLUG_LENGTH = 64;

const ORCHESTRATION_SLUG_BOUNDARY_CHAR_PATTERN = "[a-z0-9]";
const ORCHESTRATION_SLUG_INNER_CHAR_PATTERN = "[a-z0-9-]";

export const ORCHESTRATION_SLUG_BODY_PATTERN = `${ORCHESTRATION_SLUG_BOUNDARY_CHAR_PATTERN}(?:${ORCHESTRATION_SLUG_INNER_CHAR_PATTERN}*${ORCHESTRATION_SLUG_BOUNDARY_CHAR_PATTERN})?`;

function createOrchestrationSlugPattern(maxLength: number): RegExp {
  if (maxLength <= 1) {
    return new RegExp(`^${ORCHESTRATION_SLUG_BOUNDARY_CHAR_PATTERN}$`);
  }
  return new RegExp(
    `^${ORCHESTRATION_SLUG_BOUNDARY_CHAR_PATTERN}(?:${ORCHESTRATION_SLUG_INNER_CHAR_PATTERN}{0,${
      maxLength - 2
    }}${ORCHESTRATION_SLUG_BOUNDARY_CHAR_PATTERN})?$`
  );
}

export const ORCHESTRATION_SLUG_PATTERN = createOrchestrationSlugPattern(
  MAX_ORCHESTRATION_SLUG_LENGTH
);

function toSlug(value: string, fallback: string): string {
  // Keep ASCII folding and separator collapse before truncation. The final
  // trim handles a hyphen exposed by the length cap while preserving valid
  // single-character slugs. Slugs are non-injective; callers that need
  // uniqueness must still perform collision checks.
  const slug = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036F]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_ORCHESTRATION_SLUG_LENGTH)
    .replace(/^-+|-+$/g, "");

  return slug || fallback;
}

/**
 * Builds a valid, non-unique run slug. Trimming exposed boundary hyphens can
 * make long inputs produce a slug shorter than MAX_ORCHESTRATION_SLUG_LENGTH.
 */
export function toRunSlug(titleOrRequest: string): string {
  return toSlug(titleOrRequest, "run");
}

/**
 * Builds a valid, non-unique task slug. Callers must still handle collisions
 * and should not assert that long inputs always produce max-length slugs.
 */
export function toTaskSlug(title: string): string {
  return toSlug(title, "task");
}

export function isValidOrchestrationSlug(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_ORCHESTRATION_SLUG_LENGTH &&
    ORCHESTRATION_SLUG_PATTERN.test(value)
  );
}

export function assertValidOrchestrationSlug(
  value: string,
  label: string
): void {
  if (!isValidOrchestrationSlug(value)) {
    throw new TypeError(`${label} must be a valid orchestration slug`);
  }
}
