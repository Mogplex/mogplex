// Merge-queue trap guard: a required check whose workflow never triggers on
// merge_group stalls every queue entry for the full check_response_timeout
// (60 minutes). This lint makes the rule structural instead of tribal: any
// workflow that triggers on pull_request must also trigger on merge_group,
// unless it is explicitly allowlisted below with a reason.
//
// It also guards the cost rule in ci.yml: on a push to main the `scope` job
// decides whether the merge queue already passed this exact commit, and every
// other job must hang off that decision. A job that never reaches `scope`
// through `needs`, or that overrides skip propagation (`always()`,
// `!cancelled()`, `failure()`) without checking the verdict itself, would run
// the full suite on every push again, which is invisible except on the bill.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

// `tsx` does not currently populate `import.meta.dirname` for imported `.mjs`
// files, so keep a compatibility fallback for unit tests.
/* eslint-disable unicorn/prefer-import-meta-properties */
const CURRENT_DIR =
  import.meta.dirname ?? path.dirname(fileURLToPath(import.meta.url));
const CURRENT_FILENAME = import.meta.filename ?? fileURLToPath(import.meta.url);
/* eslint-enable unicorn/prefer-import-meta-properties */
const WORKFLOWS_DIR = path.resolve(CURRENT_DIR, "../.github/workflows");

// Workflows that intentionally omit merge_group. Every entry must still
// trigger on pull_request and must NOT be a required check on the main
// ruleset — required checks that skip merge groups block the queue.
/** @type {Record<string, string>} */
export const ALLOWED_WITHOUT_MERGE_GROUP = {
  "mutation.yml": "advisory path-filtered check; not required by the ruleset",
  "self-host-smoke.yml":
    "advisory path-filtered check; not required by the ruleset",
};

// Jobs in ci.yml that may run on a main push even when the merge queue has
// already passed the commit. Every entry needs a reason; none exist today.
/** @type {Record<string, string>} */
export const ALWAYS_RUN_JOBS = {};

const SCOPE_JOB = "scope";
const VERIFIED_GATE = "needs.scope.outputs.verified != 'true'";
const STATUS_OVERRIDE = /always\(\)|cancelled\(\)|failure\(\)/;

function needsOf(job) {
  const needs = job?.needs;
  if (typeof needs === "string") return [needs];
  return Array.isArray(needs) ? needs : [];
}

function reachesScope(jobs, name, seen = new Set()) {
  if (name === SCOPE_JOB) return true;
  if (seen.has(name)) return false;
  seen.add(name);
  return needsOf(jobs[name]).some((dependency) =>
    reachesScope(jobs, dependency, seen)
  );
}

function jobsOf(source) {
  const doc = parse(source);
  const jobs = doc && typeof doc === "object" ? doc.jobs : undefined;
  return jobs && typeof jobs === "object" ? jobs : {};
}

function scopeGateViolation(jobs, name) {
  if (!reachesScope(jobs, name)) {
    return {
      job: name,
      reason:
        "does not depend on `scope`, so it runs on every push to main even " +
        "when the merge queue already passed the commit. Add " +
        "`needs: [scope]` with `if: ${{ !cancelled() && " +
        `${VERIFIED_GATE} }}\`, or allowlist it in ALWAYS_RUN_JOBS with a reason.`,
    };
  }
  const job = jobs[name];
  const condition = typeof job?.if === "string" ? job.if : "";
  const directlyNeedsScope = needsOf(job).includes(SCOPE_JOB);
  if (directlyNeedsScope && condition.includes(VERIFIED_GATE)) return null;
  if (directlyNeedsScope) {
    return {
      job: name,
      reason:
        `needs \`scope\` but its \`if\` lacks \`${VERIFIED_GATE}\`, so it ` +
        "runs on every push to main even when the merge queue already " +
        "passed the commit.",
    };
  }
  if (STATUS_OVERRIDE.test(condition)) {
    return {
      job: name,
      reason:
        "uses a status function in its `if`, which runs it even when the " +
        "jobs it needs were skipped on a verified push; list `scope` in " +
        `its \`needs\` and add \`${VERIFIED_GATE}\` to the condition.`,
    };
  }
  return null;
}

export function findScopeGateViolations(source, alwaysRun = ALWAYS_RUN_JOBS) {
  const jobs = jobsOf(source);
  if (!Object.hasOwn(jobs, SCOPE_JOB)) {
    return [
      {
        job: SCOPE_JOB,
        reason:
          "is missing from ci.yml; it decides on each push to main whether " +
          "the merge queue already passed the commit, and every other job " +
          "must depend on it.",
      },
    ];
  }
  const gated = Object.keys(jobs).filter(
    (name) => name !== SCOPE_JOB && !Object.hasOwn(alwaysRun, name)
  );
  const stale = Object.keys(alwaysRun)
    .filter((name) => !Object.hasOwn(jobs, name))
    .map((name) => ({
      job: name,
      reason:
        "is allowlisted in ALWAYS_RUN_JOBS but does not exist in ci.yml; " +
        "remove the stale allowlist entry.",
    }));
  return [
    ...gated.map((name) => scopeGateViolation(jobs, name)).filter(Boolean),
    ...stale,
  ];
}

function extractTriggers(source) {
  const doc = parse(source);
  if (!doc || typeof doc !== "object") return [];
  // YAML 1.1 parsers read a bare `on` key as boolean true (which lands on the
  // "true" property in JS); the yaml package defaults to 1.2 (plain "on"), but
  // normalize both so a schema change cannot silently disable this lint.
  const triggers = doc.on ?? doc.true;
  if (typeof triggers === "string") return [triggers];
  if (Array.isArray(triggers)) return triggers;
  if (triggers && typeof triggers === "object") return Object.keys(triggers);
  return [];
}

function checkWorkflow({ file, source }, allowlist) {
  const triggers = extractTriggers(source);
  const listensToPullRequest =
    triggers.includes("pull_request") ||
    triggers.includes("pull_request_target");
  const listensToMergeGroup = triggers.includes("merge_group");
  const allowlisted = Object.hasOwn(allowlist, file);

  if (listensToPullRequest && !listensToMergeGroup && !allowlisted) {
    return {
      file,
      reason:
        "triggers on pull_request but not merge_group; if any of its checks " +
        "are (or become) required, the merge queue stalls for the full " +
        "check_response_timeout. Add `merge_group:` to its `on:` block (a " +
        "job-level `if` may skip the work there — a skipped job satisfies a " +
        "required check), or allowlist it in " +
        "scripts/check-merge-group-triggers.mjs with a reason.",
    };
  }

  if (allowlisted && (!listensToPullRequest || listensToMergeGroup)) {
    return {
      file,
      reason:
        "is allowlisted in scripts/check-merge-group-triggers.mjs but no " +
        "longer needs the exemption; remove the stale allowlist entry.",
    };
  }

  return null;
}

export function findMergeGroupViolations(
  workflows,
  allowlist = ALLOWED_WITHOUT_MERGE_GROUP
) {
  const violations = workflows
    .map((workflow) => checkWorkflow(workflow, allowlist))
    .filter(Boolean);

  const seenFiles = new Set(workflows.map((workflow) => workflow.file));
  for (const file of Object.keys(allowlist)) {
    if (!seenFiles.has(file)) {
      violations.push({
        file,
        reason:
          "is allowlisted in scripts/check-merge-group-triggers.mjs but does " +
          "not exist in .github/workflows; remove the stale allowlist entry.",
      });
    }
  }

  return violations;
}

async function loadWorkflows() {
  const entries = await readdir(WORKFLOWS_DIR);
  const files = entries
    .filter((entry) => entry.endsWith(".yml") || entry.endsWith(".yaml"))
    .toSorted((left, right) => left.localeCompare(right));
  return Promise.all(
    files.map(async (file) => ({
      file,
      source: await readFile(path.join(WORKFLOWS_DIR, file), "utf8"),
    }))
  );
}

async function main() {
  const workflows = await loadWorkflows();
  const violations = findMergeGroupViolations(workflows);
  const ci = workflows.find((workflow) => workflow.file === "ci.yml");
  const scopeViolations = ci ? findScopeGateViolations(ci.source) : [];
  if (violations.length === 0 && scopeViolations.length === 0) {
    process.stdout.write(
      `OK: ${workflows.length} workflows checked; every pull_request workflow also triggers on merge_group, and every ci.yml job is gated by scope.\n`
    );
    return 0;
  }
  for (const violation of violations) {
    process.stderr.write(`${violation.file}: ${violation.reason}\n`);
  }
  for (const violation of scopeViolations) {
    process.stderr.write(`ci.yml job ${violation.job}: ${violation.reason}\n`);
  }
  return 1;
}

const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]) === CURRENT_FILENAME;

if (isDirectExecution) {
  // Matches sync-harness-configs.mjs: the unit-test runner transpiles this
  // module to CJS, where top-level await is unavailable.
  // eslint-disable-next-line unicorn/prefer-top-level-await
  void (async () => {
    try {
      process.exitCode = await main();
    } catch (error) {
      process.stderr.write(
        `${error instanceof Error ? error.message : "merge_group lint failed"}\n`
      );
      process.exitCode = 1;
    }
  })();
}
