/**
 * Build a stable, human-readable sandbox name for the v2 SDK.
 *
 * Vercel requires sandbox names unique per project. Per the v2
 * migration plan, our scheme is:
 *
 *     mogplex-{userShort}-{teamShort?}-{repoShort}-{branchShort}-{rootShort}
 *
 * - `userShort`   : first 6 chars of the owning user id.
 * - `repoShort`   : first 6 chars of the repo UUID.
 * - `teamShort`   : first 6 chars of the active product team id, when present.
 * - `branchShort` : slugified working branch, truncated to fit.
 * - `rootShort`   : slugified launch rootDirectory, or `root` for repo root.
 *
 * The name is STABLE per working tree — pausing and resuming the
 * same (user, optional team, repo, branch, rootDirectory) reuses the same
 * sandbox name on the Vercel side so persistent resume via
 * Sandbox.get({ resume: true }) works without DB coordination. Operators
 * grepping the Vercel sandbox list can locate a user's sandbox directly
 * from the name.
 *
 * Uniqueness caveat: if a prior sandbox with this name is still
 * live on Vercel when we attempt to create a new one (e.g. DB row
 * was deleted manually but the Vercel sandbox wasn't), the launch
 * flow probes the name first and either resumes/adopts the existing
 * sandbox or deletes a stopped/error handle before creating fresh.
 *
 * Total length bounded at 60 chars, charset [a-z0-9-].
 */

const MAX_NAME_LEN = 60;
const MIN_TRUNCATED_IDENTITY_SEGMENT_LEN = 6;

function sanitizeSegment(value: string | null | undefined): string {
  if (!value) return "";
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || ""
  );
}

function shortenSegment(value: string, max: number): string {
  if (value.length <= max) return value;
  const shortened = value.slice(0, max).replace(/-+$/g, "");
  return shortened || value.charAt(0);
}

function allocateIdentityBudgets(
  branch: string,
  rootDirectory: string,
  budget: number
) {
  // buildSandboxName clamps this to at least 2 so both identity segments survive.
  if (budget <= 2) {
    return { branchBudget: 1, rootBudget: 1 };
  }

  const branchFloor = Math.min(
    branch.length,
    MIN_TRUNCATED_IDENTITY_SEGMENT_LEN
  );
  const rootFloor = Math.min(
    rootDirectory.length,
    MIN_TRUNCATED_IDENTITY_SEGMENT_LEN
  );
  if (branchFloor + rootFloor > budget) {
    const branchBudget = Math.max(1, Math.ceil(budget / 2));
    return {
      branchBudget,
      rootBudget: Math.max(1, budget - branchBudget),
    };
  }

  const branchRemainder = Math.max(0, branch.length - branchFloor);
  const rootRemainder = Math.max(0, rootDirectory.length - rootFloor);
  const remaining = budget - branchFloor - rootFloor;
  const totalRemainder = branchRemainder + rootRemainder;

  if (totalRemainder === 0) {
    return { branchBudget: branchFloor, rootBudget: rootFloor };
  }

  const branchExtra = Math.min(
    branchRemainder,
    Math.round((remaining * branchRemainder) / totalRemainder)
  );
  return {
    branchBudget: branchFloor + branchExtra,
    rootBudget: rootFloor + remaining - branchExtra,
  };
}

function shortId(value: string | null | undefined, fallback: string, len = 6) {
  const cleaned = (value ?? "").replace(/-/g, "");
  return cleaned.slice(0, len) || fallback;
}

export function buildSandboxName(input: {
  repoId: string;
  workingBranch: string | null | undefined;
  /** Optional: when provided, mixes a 6-char user-id slug into the
   * name so multiple users sharing a Vercel project don't collide
   * on matching repo+branch launches. */
  userId?: string | null;
  productTeamId?: string | null;
  rootDirectory?: string | null;
  /**
   * @deprecated Retained for call-site compatibility but intentionally
   * ignored. The plan calls for stable names per working tree so
   * pause/resume reuses the same Vercel sandbox; including a fresh
   * record id per launch would produce a new name every attempt.
   */
  recordId?: string;
}): string {
  const userShort = input.userId ? shortId(input.userId, "anon") : null;
  const teamShort = input.productTeamId
    ? `t${shortId(input.productTeamId, "team")}`
    : null;
  const repoShort = shortId(input.repoId, "repo");
  const branch = sanitizeSegment(input.workingBranch ?? "") || "main";
  const rootDirectory = sanitizeSegment(input.rootDirectory ?? "") || "root";

  const segments = ["mogplex"];
  if (userShort) segments.push(userShort);
  if (teamShort) segments.push(teamShort);
  segments.push(repoShort, branch, rootDirectory);

  const candidate = segments.join("-");
  if (candidate.length <= MAX_NAME_LEN) return candidate;

  // Branch/root segments were unusually long after sanitize — shrink them to fit
  // while keeping both identity dimensions present in the final name.
  const fixedSegments = segments.slice();
  fixedSegments[fixedSegments.length - 2] = "{BRANCH}";
  fixedSegments[fixedSegments.length - 1] = "{ROOT}";
  const fixedOverhead =
    fixedSegments.join("-").length - "{BRANCH}".length - "{ROOT}".length;
  const variableBudget = Math.max(2, MAX_NAME_LEN - fixedOverhead);
  const { branchBudget, rootBudget } = allocateIdentityBudgets(
    branch,
    rootDirectory,
    variableBudget
  );

  fixedSegments[fixedSegments.length - 2] = shortenSegment(
    branch,
    branchBudget
  );
  fixedSegments[fixedSegments.length - 1] = shortenSegment(
    rootDirectory,
    rootBudget
  );
  return fixedSegments.join("-");
}
