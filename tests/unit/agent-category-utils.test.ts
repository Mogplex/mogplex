import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_CATEGORY_SLUG_PATTERN,
  MAX_AGENT_CATEGORY_SLUG_LENGTH,
  dedupeCategorySlug,
  isValidCategorySlug,
  normalizeCategoryLabel,
  slugifyCategoryLabel,
} from "../../lib/agents/category-utils";

test("normalizeCategoryLabel trims and collapses whitespace", () => {
  assert.equal(normalizeCategoryLabel("  Sales   Ops  "), "Sales Ops");
  assert.equal(normalizeCategoryLabel("\tA\n\nB\t"), "A B");
  assert.equal(normalizeCategoryLabel(""), "");
  assert.equal(normalizeCategoryLabel(null), "");
  assert.equal(normalizeCategoryLabel(42), "");
});

test("slugifyCategoryLabel lowercases, ascii-folds, and joins with hyphens", () => {
  assert.equal(slugifyCategoryLabel("Sales Ops"), "sales-ops");
  assert.equal(slugifyCategoryLabel("Café Résumé"), "cafe-resume");
  assert.equal(slugifyCategoryLabel("!!! hello_world !!!"), "hello-world");
  assert.equal(slugifyCategoryLabel("A / B / C"), "a-b-c");
});

test("slugifyCategoryLabel clamps to the max slug length with no trailing hyphen", () => {
  const long = "a".repeat(60);
  const slug = slugifyCategoryLabel(long);
  assert.equal(slug.length, MAX_AGENT_CATEGORY_SLUG_LENGTH);
  assert.match(slug, AGENT_CATEGORY_SLUG_PATTERN);

  // truncation must not leave a trailing hyphen that would fail the pattern
  const boundary = `${"a".repeat(39)}-extra`;
  const boundarySlug = slugifyCategoryLabel(boundary);
  assert.equal(boundarySlug.endsWith("-"), false);
  assert.match(boundarySlug, AGENT_CATEGORY_SLUG_PATTERN);
});

test("slugifyCategoryLabel returns an empty string for no-letter input", () => {
  assert.equal(slugifyCategoryLabel("!!!"), "");
  assert.equal(slugifyCategoryLabel("   "), "");
});

test("isValidCategorySlug enforces the documented pattern", () => {
  assert.equal(isValidCategorySlug("sales-ops"), true);
  assert.equal(isValidCategorySlug("a"), true);
  assert.equal(
    isValidCategorySlug("a".repeat(MAX_AGENT_CATEGORY_SLUG_LENGTH)),
    true
  );
  assert.equal(
    isValidCategorySlug("a".repeat(MAX_AGENT_CATEGORY_SLUG_LENGTH + 1)),
    false
  );
  assert.equal(isValidCategorySlug("-leading"), false);
  assert.equal(isValidCategorySlug("Upper"), false);
  assert.equal(isValidCategorySlug(""), false);
  assert.equal(isValidCategorySlug(null), false);
});

test("dedupeCategorySlug returns the base slug when it is free", () => {
  assert.equal(dedupeCategorySlug("sales", new Set()), "sales");
  assert.equal(dedupeCategorySlug("sales", new Set(["other"])), "sales");
});

test("dedupeCategorySlug yields suffixed slugs within the validation pattern", () => {
  const baseSlug = slugifyCategoryLabel("a".repeat(60));
  assert.equal(baseSlug.length, MAX_AGENT_CATEGORY_SLUG_LENGTH);

  const seen = new Set<string>();
  const taken = new Set<string>([baseSlug]);
  for (let i = 2; i <= 20; i++) {
    const slug = dedupeCategorySlug(baseSlug, taken)!;
    assert.ok(slug, `collision at ${i}`);
    assert.ok(
      slug.length <= MAX_AGENT_CATEGORY_SLUG_LENGTH,
      `slug ${slug} (${slug.length}) exceeds max length`
    );
    assert.match(slug, AGENT_CATEGORY_SLUG_PATTERN);
    assert.equal(
      seen.has(slug),
      false,
      `duplicate slug ${slug} from suffix ${i}`
    );
    seen.add(slug);
    taken.add(slug);
  }
});

test("dedupeCategorySlug strips trailing hyphens after truncation", () => {
  const base = `${"a".repeat(37)}-bc`;
  const taken = new Set([base]);
  const slug = dedupeCategorySlug(base, taken)!;
  assert.ok(slug);
  assert.equal(slug.endsWith("-"), false);
  assert.match(slug, AGENT_CATEGORY_SLUG_PATTERN);
});

test("dedupeCategorySlug returns null when all attempts collide", () => {
  const base = "cat";
  const taken = new Set<string>([base]);
  for (let i = 2; i <= 20; i++) taken.add(`${base}-${i}`);
  assert.equal(dedupeCategorySlug(base, taken), null);
});
