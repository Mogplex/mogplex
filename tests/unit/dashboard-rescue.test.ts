import assert from "node:assert/strict";
import test from "node:test";
import {
  DASHBOARD_SCOPED_FIRST_SEGMENTS,
  isDashboardScopedFirstSegment,
} from "../../lib/dashboard-rescue";
import { isReservedSlug } from "../../lib/reserved-slugs";

test("isDashboardScopedFirstSegment recognises known dashboard segments", () => {
  for (const segment of [
    "agents",
    "assignments",
    "automations",
    "flows",
    "library",
    "observability",
    "primitives",
    "projects",
    "runs",
    "settings",
    "triggers",
    "workflows",
  ]) {
    assert.equal(
      isDashboardScopedFirstSegment(segment),
      true,
      `expected ${segment} to be a scoped dashboard segment`
    );
  }
});

test("isDashboardScopedFirstSegment rejects unrelated segments", () => {
  for (const segment of ["api", "login", "auth", "nope", "", "alice"]) {
    assert.equal(
      isDashboardScopedFirstSegment(segment),
      false,
      `expected ${segment} to not be a scoped dashboard segment`
    );
  }
});

test("isDashboardScopedFirstSegment is case-insensitive", () => {
  // `isReservedSlug` lowercases its input, so `/Agents/skills` already
  // resolves to `not_found`. The rescue check must match that behaviour
  // or capitalised links silently fall through to a 404.
  for (const segment of ["Agents", "AGENTS", "Settings", "ProJects"]) {
    assert.equal(
      isDashboardScopedFirstSegment(segment),
      true,
      `expected ${segment} to be recognised case-insensitively`
    );
  }
});

test("DASHBOARD_SCOPED_FIRST_SEGMENTS is exposed as a readonly set", () => {
  // Sanity: the set is non-empty so the rescue actually engages.
  assert.ok(DASHBOARD_SCOPED_FIRST_SEGMENTS.size > 0);
});

test("every dashboard-scoped segment is also a reserved slug", () => {
  // Drift guard: a new section added to DASHBOARD_SCOPED_FIRST_SEGMENTS
  // must be unclaimable as a personal or team slug, otherwise the rescue
  // redirect can be shadowed by a real profile owning the segment.
  for (const segment of DASHBOARD_SCOPED_FIRST_SEGMENTS) {
    assert.equal(
      isReservedSlug(segment),
      true,
      `expected ${segment} to be reserved`
    );
  }
});

test("public static root files are reserved slugs", () => {
  for (const slug of ["robots.txt", "sitemap.xml", "llms.txt"]) {
    assert.equal(isReservedSlug(slug), true, `expected ${slug} to be reserved`);
  }
});
