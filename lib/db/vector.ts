/** Preserve SQL arrays; only pgvector parameters need bracketed text. */
export function serializeVectorValue(
  value: unknown,
  sqlType?: string
): unknown {
  // pg encodes JavaScript arrays as Postgres array literals ({...}), whereas
  // pgvector accepts bracketed vector literals ([...]). Catalog types can be
  // schema-qualified and column types may include a dimension modifier.
  return Array.isArray(value) &&
    /(?:^|\.)vector(?:\(\d+\))?$/.test(sqlType ?? "")
    ? JSON.stringify(value)
    : value;
}
