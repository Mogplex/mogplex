import type { FlowStartFilter } from "@/lib/types";

export type TriggerFilterAccountType = "User" | "Organization";

export type TriggerFilterContext = {
  installationId: number;
  repoFullName: string | null;
  accountType: TriggerFilterAccountType;
  // PR/issue author from the webhook payload. Only present for events that
  // have an author (e.g. pr_opened); author-based filter modes degrade
  // conservatively when missing (see evaluateAuthorFilter).
  authorLogin?: string | null;
  authorIsBot?: boolean | null;
};

// Dependabot authors PRs as "dependabot[bot]" (and historically
// "dependabot-preview[bot]"). Match those logins exactly: GitHub reserves the
// "[bot]" suffix for App accounts and usernames cannot contain brackets, so a
// user named e.g. "dependabot-helper" cannot spoof their way into a
// dependabot_only flow (which may auto-merge).
const DEPENDABOT_LOGINS: ReadonlySet<string> = new Set([
  "dependabot[bot]",
  "dependabot-preview[bot]",
]);

export function isDependabotLogin(login: string | null | undefined): boolean {
  if (typeof login !== "string") return false;
  return DEPENDABOT_LOGINS.has(login.trim().toLowerCase());
}

function evaluateAuthorFilter(
  mode: FlowStartFilter["authorFilter"],
  ctx: TriggerFilterContext
): boolean {
  if (!mode || mode === "any") return true;

  const hasAuthorContext = ctx.authorLogin != null || ctx.authorIsBot != null;

  switch (mode) {
    case "humans_only":
      // Missing author info: allow. Exclusion modes only reject when we can
      // positively identify a bot, so unknown payload shapes fail open and
      // do not silently drop human PRs.
      return !(ctx.authorIsBot === true || isDependabotLogin(ctx.authorLogin));
    case "exclude_dependabot":
      return !isDependabotLogin(ctx.authorLogin);
    case "dependabot_only":
      // Inclusion mode fails closed: without positive identification the
      // flow must not run (it may merge PRs).
      return hasAuthorContext && isDependabotLogin(ctx.authorLogin);
    default:
      return true;
  }
}

// Normalize a raw account-type string from the GitHub webhook payload.
// GitHub sends literal "User" or "Organization" in installation.target_type and
// installation.account.type. We default unknown/missing to "User" because that
// is the *narrower* scope: a flow filtered to "org" rejects a "User" context, so
// defaulting cannot accidentally over-route. Phase 2 is shadow-mode anyway.
export function normalizeAccountType(
  raw: string | null | undefined
): TriggerFilterAccountType {
  if (typeof raw !== "string") return "User";
  const cleaned = raw.trim().toLowerCase();
  if (cleaned === "organization") return "Organization";
  return "User";
}

// Distinguish "raw matched a canonical value" from "raw was missing/unknown and
// got the default". Callers that want to log unknown payload shapes should use
// this rather than re-implementing the trim/lowercase check, so the two cannot
// drift from normalizeAccountType.
export function isKnownAccountType(raw: string | null | undefined): boolean {
  if (typeof raw !== "string") return false;
  const cleaned = raw.trim().toLowerCase();
  return cleaned === "user" || cleaned === "organization";
}

export function evaluateTriggerFilter(
  filter: FlowStartFilter | undefined,
  ctx: TriggerFilterContext
): boolean {
  if (!filter) return true;

  if (filter.scope === "org" && ctx.accountType !== "Organization")
    return false;
  if (filter.scope === "personal" && ctx.accountType !== "User") return false;

  if (
    filter.installationIds &&
    filter.installationIds.length > 0 &&
    !filter.installationIds.includes(ctx.installationId)
  )
    return false;

  if (filter.repos && filter.repos.length > 0) {
    if (!ctx.repoFullName) return false;
    const target = ctx.repoFullName.trim().toLowerCase();
    const allowed = filter.repos.some(
      (repo) => repo.trim().toLowerCase() === target
    );
    if (!allowed) return false;
  }

  if (!evaluateAuthorFilter(filter.authorFilter, ctx)) return false;

  return true;
}
