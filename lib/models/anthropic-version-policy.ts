type AnthropicPolicyRow = {
  id: string;
  provider: string;
  pricing_input: number | null;
  pricing_output: number | null;
};

type ClaudeFamilyVersion = {
  family: string;
  version: number[];
  /**
   * Serving variant, e.g. the `-fast` in `claude-opus-5-fast`. Empty for the
   * standard model. Only ever compared for equality: a variant is its own
   * version line (`opus-4.8-fast` -> `opus-5-fast`, never -> `opus-5`), because
   * variants differ in latency and price, so treating them as interchangeable
   * would move a pin onto a model with different serving characteristics.
   *
   * Deliberately any *letter-leading* suffix, not an allowlist of known variant
   * names: a variant is a version line whatever Anthropic calls it, so
   * `-thinking` or `-preview` would supersede within themselves without anyone
   * editing this file. That does widen the surface beyond the `-fast` case this
   * was written for — a suffix that today is retained only because it fails to
   * parse would start being superseded — but the direction is safe. Equality
   * means a variant can never be moved onto a different line, and the
   * same-pricing guard still has to agree, so the worst case is the pre-existing
   * "retained forever".
   *
   * Multi-segment variants are intended, not incidental: `-fast-preview` parses
   * to `fast-preview` and forms a line distinct from `-fast`, so a compound
   * variant works without editing the regex.
   *
   * The letter-leading requirement is load-bearing and not obvious from the
   * regex: it is what keeps date-stamped ids like `claude-opus-4-5-20251101`
   * unparseable, so they stay retained rather than being read as version 4 of a
   * "5-20251101" variant. The cost is that mixed suffixes such as
   * `-fast-20250101` or `-thinking-16k` also fail to parse and land back in
   * "retained forever" — the safe direction, and the same place they are today.
   */
  variant: string;
};

// Anthropic ids appear in two shapes: "claude-opus-4.8" and "claude-3.7-sonnet",
// each optionally carrying a serving-variant suffix ("claude-opus-5-fast").
const FAMILY_THEN_VERSION =
  /^claude-(opus|sonnet|haiku|fable)-(\d+(?:\.\d+)*)(?:-([a-z][\da-z]*(?:-[a-z][\da-z]*)*))?$/;
const VERSION_THEN_FAMILY =
  /^claude-(\d+(?:\.\d+)*)-(opus|sonnet|haiku|fable)(?:-([a-z][\da-z]*(?:-[a-z][\da-z]*)*))?$/;

function parseClaudeFamilyVersion(id: string): ClaudeFamilyVersion | null {
  const slug = id.split("/").at(-1) ?? id;

  const familyFirst = slug.match(FAMILY_THEN_VERSION);
  if (familyFirst) {
    return {
      family: familyFirst[1],
      version: familyFirst[2].split(".").map(Number),
      variant: familyFirst[3] ?? "",
    };
  }

  const versionFirst = slug.match(VERSION_THEN_FAMILY);
  if (versionFirst) {
    return {
      family: versionFirst[2],
      version: versionFirst[1].split(".").map(Number),
      variant: versionFirst[3] ?? "",
    };
  }

  return null;
}

function compareVersions(left: number[], right: number[]) {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export type AnthropicSupersession = {
  deprecatedId: string;
  successorId: string;
};

// The version of `candidate` when it is a same-family, same-pricing Anthropic
// row that outranks `parsed`; null when it is not a valid successor.
function supersedingVersionOf<T extends AnthropicPolicyRow>(
  candidate: T,
  row: T,
  parsed: ClaudeFamilyVersion
): number[] | null {
  if (candidate === row || candidate.provider !== "anthropic") return null;
  if (
    candidate.pricing_input !== row.pricing_input ||
    candidate.pricing_output !== row.pricing_output
  ) {
    return null;
  }

  const candidateParsed = parseClaudeFamilyVersion(candidate.id);
  if (candidateParsed?.family !== parsed.family) return null;
  // Same variant line only. The pricing check alone does not cover this: a
  // variant can coincidentally match the standard model's price, and a `-fast`
  // pin swapped onto a standard model would silently change the latency the
  // automation was pinned for.
  if (candidateParsed.variant !== parsed.variant) return null;
  if (compareVersions(candidateParsed.version, parsed.version) <= 0)
    return null;

  return candidateParsed.version;
}

// The newest same-family, same-pricing row that outranks `row`, or null when
// nothing supersedes it. Picking the *newest* (not merely the next one up)
// means a single sync collapses 4.6 -> 5 and 4.7 -> 5 directly, so the
// supersession mapping never needs a chain walk within one sync pass.
function findNewestSupersedingRow<T extends AnthropicPolicyRow>(
  row: T,
  rows: T[]
): T | null {
  if (row.provider !== "anthropic") return null;
  if (row.pricing_input === null || row.pricing_output === null) return null;

  const parsed = parseClaudeFamilyVersion(row.id);
  if (!parsed) return null;

  let successor: T | null = null;
  let successorVersion: number[] | null = null;

  for (const other of rows) {
    const version = supersedingVersionOf(other, row, parsed);
    if (!version) continue;

    if (
      successorVersion === null ||
      compareVersions(version, successorVersion) > 0
    ) {
      successor = other;
      successorVersion = version;
    }
  }

  return successor;
}

/**
 * Anthropic business rule: when an Anthropic model exists with the same
 * pricing and an earlier version in the same Claude family (opus, sonnet,
 * haiku, fable) and serving variant, only the newest version is offered. E.g.
 * if Opus 4.6, 4.7, 4.8, and 5 all share the same $5/$25 pricing, only Opus 5
 * is retained; `claude-opus-4.8-fast` is likewise superseded by
 * `claude-opus-5-fast` and never by plain `claude-opus-5`.
 *
 * Returns both the retained rows *and* the deprecated -> successor mapping, so
 * callers can upgrade saved references (automation model overrides, agent base
 * models, default models) instead of leaving them pinned to a model the stale
 * sweep is about to mark unavailable.
 *
 * Rows with unparseable ids or missing pricing are kept — the rule only
 * applies when both the version and the pricing can be compared.
 */
export function resolveAnthropicNewestVersionPolicy<
  T extends AnthropicPolicyRow,
>(rows: T[]): { retained: T[]; supersessions: AnthropicSupersession[] } {
  const retained: T[] = [];
  const supersessions: AnthropicSupersession[] = [];

  for (const row of rows) {
    const successor = findNewestSupersedingRow(row, rows);
    if (!successor) {
      retained.push(row);
      continue;
    }
    supersessions.push({
      deprecatedId: row.id,
      successorId: successor.id,
    });
  }

  return { retained, supersessions };
}
