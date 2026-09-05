# Testing Policy

This policy exists so that no behavior change ships on the word of its author.
Every feature, fix, and refactor lands with proof that it works and a tripwire
that fires when it breaks. A change without that proof is not done, regardless
of how clean the diff looks.

## Test tiers

| Tier | Command | Location | Runs against |
| --- | --- | --- | --- |
| Lib | `pnpm test` | `lib/**/*.test.ts` (colocated) | Pure functions, no I/O |
| Unit | `pnpm test:unit` | `tests/unit/` | Route handlers, presenters, tools (node:test via tsx) |
| DB | `pnpm test:db` | `tests/db/` | Real Postgres schema: migrations, triggers, the PostgREST shim, ledger semantics |
| E2E | `pnpm test:e2e` | `tests/e2e/` | Production build in a browser (Playwright, Chromium) |

CI runs `lint`, `typecheck`, `test:all` (lib + unit + DB), `build`, and `e2e`
on every PR. Green CI is necessary, not sufficient — CI only exercises the
tests you wrote, so the policy below is about which tests a change must bring
with it.

## Required coverage by change class

Pick the tier where the behavior actually lives. If a change spans classes,
each class carries its own requirement.

- **Pure logic in `lib/`** — colocated vitest test next to the module.
- **API route, server presenter, or agent tool** — a `tests/unit/` suite
  covering the success path and at least the input-validation and auth-failure
  paths.
- **Migration, trigger, or anything that changes what a query returns** — a
  `tests/db/` case that applies the real migrations and asserts the new
  behavior at the SQL boundary. A migration with no DB test does not merge.
- **User-visible behavior** (a pane, a flow, a settings surface) — one e2e
  regression spec exercising the change the way a user would, added or updated
  in the relevant `tests/e2e/` suite.
- **Regression fix** — a test that fails on the commit before the fix. Write
  it first; if you cannot make it fail, you have not found the bug.
- **Flow run-control changes** — update the `tests/unit/flow-run-presentation-*`
  contract suites before changing logic, plus one e2e regression spec in
  `tests/e2e/flows-pane-runs-*` for rail or modal behavior (see AGENTS.md).

A PR that changes behavior but touches no test files must say why in its
description with a `No-tests:` line (see Enforcement below). "Covered by
existing tests" is only valid with the suite named.

## What counts as a test

These rules exist because a test that cannot fail is worse than no test: it
converts a gap into false confidence.

1. **It must go red when the feature breaks.** Before finalizing, revert or
   deliberately break the change under test and confirm the new test fails.
   A test that has never failed proves nothing.
2. **Assert observable behavior, not wiring.** Asserting that a mock was
   called with the arguments you configured it to receive tests your test,
   not the product. Assert what a caller or user would see.
3. **Mock only at boundaries** — network, external providers, the clock, and
   the database outside the DB tier. If a test mocks everything the code
   touches, it is in the wrong tier: move it down to lib or up to DB/e2e.
4. **No snapshot-only assertions** for behavior. A broad snapshot asserts
   "the output is whatever it was," which is the definition of slop passing
   review.
5. **Fixtures are typed**, built with small builder helpers when a shape
   repeats. Untyped fixtures rot silently when the schema moves.
6. **Failing tests block; skipped tests are debt.** Never land `.only` or a
   bare `.skip` on `main`. A flaky test gets a linked issue and a skip with
   the issue number, or it gets fixed — it does not get deleted to make CI
   green.
7. **Error paths are part of the feature.** Async code that talks to the
   sandbox, GitHub, or the database needs at least one test for the failure
   it will actually encounter (timeout, 401, missing row).

## Public tests vs. private qualification

Mogplex is developed in the open, and its correctness tests are part of the
public contributor contract. Release qualification for the hosted service is
not. The boundary:

**In this repository:**

- All unit, integration, database, migration, and e2e tests described above.
- Anything a self-hosting contributor could and should run to verify a change.
- Tests must run — or self-skip cleanly — without hosted-service secrets.
  Specs that need a real database connection follow the existing pattern of
  skipping when the relevant environment variable is unset, and must never
  reference internal environment variables that are not part of the public
  self-hosting docs.

**Not in this repository** (the hosted service maintains a private release
qualification suite):

- Production-derived or adversarial evaluation cases.
- Hidden expected outcomes, scoring rubrics, and ship/no-ship thresholds.
- Model and provider drift, delivery-quality, and safety evaluations.
- Baselines and release-gate automation for the official service.

The decision rule: if the test verifies that the *code* is correct, it is
public and lives here. If it verifies that a *release of the hosted service*
is good enough to ship, it is private. Correctness tests are never moved out
of this repository to the private side — hiding a correctness test hides the
contract it protects.

Contributor PRs are evaluated on the public suites alone; private
qualification runs against exact commits of `main` and never gates or
comments on public pull requests with private case details.

## Enforcement

Two of the rules above are checked mechanically:

- **Mock only at boundaries** is enforced by the `testing/no-internal-mocks`
  ESLint rule (`scripts/eslint-rules/no-internal-mocks.mjs`), which runs on
  every `*.test.ts` / `*.spec.ts` file in the normal lint job. It rejects
  module mocks and spies on internal code and permits them only for the
  boundaries declared in `tests/support/mockable-boundaries.mjs`. That
  allowlist is owner-gated in CODEOWNERS: widening it is a reviewed decision,
  not a drive-by.
- **No silent test-free features** is enforced by the `pr-protection`
  workflow. A PR that changes source under `app/`, `lib/`, `components/`,
  `hooks/`, or `trigger/` without touching any test file fails the check
  unless the PR body contains a line of the form
  `No-tests: <reason, naming the existing suite if one covers this>`.
  The reason is visible in the check output, so reviewers see the claim and
  can challenge it.

Two advisory checks probe whether tests are meaningful, not just present:

- **diff-coverage** (`pr-protection.yml`) combines LCOV reports from the lib,
  unit, and DB tiers and fails when changed `lib/**` lines are under 80%
  covered. Unit coverage uses Node's native runner with source maps; the lib
  and DB tiers use Vitest's V8 coverage. Tests stay in the tier where their
  behavior lives, and execution in any tier counts. It gates only
  the lines a PR touches, so coverage ratchets up with each change instead of
  demanding a backfill.
- **mutation** (`mutation.yml`) runs incremental Stryker over the `lib/**`
  files a PR changes and reports how many mutants the vitest tier kills. It
  never fails on the score — a low score is the machine-checked version of
  "would this test still pass if the feature silently stopped working?"

Neither advisory check blocks the merge, but reviewers should treat a red
diff-coverage or a low mutation score as a finding to resolve. Lint and these
checks shrink the slop surface; they cannot fully prove a test's assertions
are meaningful. That last step remains the "make it go red" rule and the
reviewer checklist below.

## Reviewer checklist

- Does each behavior change have a test in the tier where the behavior lives?
- Did the author show (or can you locally confirm) the new test fails without
  the change?
- Do the assertions describe behavior a user or caller depends on?
- Would this test still pass if the feature silently stopped working? If yes,
  it does not count toward the requirement.
- Are any new tests placed on the correct side of the public/private boundary?
