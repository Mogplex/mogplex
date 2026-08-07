// The executable form of the "mock only at boundaries" rule in TESTING.md.
// The `no-internal-mocks` ESLint rule (scripts/eslint-rules/) allows module
// mocking and global stubbing only for the entries below. Widening this list
// is a reviewed decision — the file is owner-gated in CODEOWNERS.
//
// A module belongs here only if it crosses a process or network boundary the
// test genuinely cannot exercise (external SaaS, microVMs, live providers).
// Internal modules (`@/lib/**`, relative imports) are never mockable: test
// them for real, or move the test to the tier where that is possible
// (tests/db for schema behavior, tests/e2e for the running app).

/**
 * Module specifiers that may be mocked with `vi.mock` / `mock.module`.
 * Entries ending in "/" match as prefixes; all others match exactly.
 */
export const boundaryModules = ["@vercel/sandbox", "octokit", "@octokit/"];

/**
 * Globals that may be replaced with `vi.stubGlobal`.
 * `fetch` is the network boundary; the clock goes through fake timers, not
 * a stubbed `Date`.
 */
export const stubbableGlobals = ["fetch"];
