import { NextResponse } from "next/server";
import { requireProfileId } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { listGithubOrgMembersWithEmails } from "@/lib/github/org-members";
import { GithubHttpError } from "@/lib/github-app";

export type OrgMembersResponse = {
  members: Array<{ login: string; email: string | null }>;
  no_email_count: number;
};

function isOrgInstallation(targetType: string | null) {
  if (!targetType) return false;
  return targetType.toLowerCase().includes("org");
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ installationId: string }> }
) {
  const profileId = await requireProfileId();
  if (profileId instanceof Response) return profileId;

  const { installationId: installationIdParam } = await context.params;
  const installationId = /^\d+$/.test(installationIdParam)
    ? Number(installationIdParam)
    : NaN;

  if (!Number.isFinite(installationId)) {
    return NextResponse.json(
      { error: "installationId must be numeric" },
      { status: 422 }
    );
  }

  const { data: installation, error } = await supabaseAdmin
    .from("github_installations")
    .select("installation_id, account_login, target_type, account_type")
    .eq("user_id", profileId)
    .eq("installation_id", installationId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  // 404 (rather than 403) when the caller doesn't own this installation row
  // so we don't disclose which installations exist for other users.
  if (!installation) {
    return NextResponse.json(
      { error: "Installation not found" },
      { status: 404 }
    );
  }

  const targetType = (installation.target_type as string | null) ?? null;
  const accountLogin = (installation.account_login as string | null) ?? null;

  if (!isOrgInstallation(targetType)) {
    return NextResponse.json(
      { error: "Installation is not an organization" },
      { status: 400 }
    );
  }
  if (!accountLogin) {
    return NextResponse.json(
      { error: "Installation is missing org login" },
      { status: 422 }
    );
  }

  try {
    const members = await listGithubOrgMembersWithEmails(
      installationId,
      accountLogin
    );
    const no_email_count = members.reduce(
      (acc, m) => acc + (m.email ? 0 : 1),
      0
    );
    return NextResponse.json({
      members,
      no_email_count,
    });
  } catch (err) {
    // Surface 401/403 distinctly so the UI can prompt the org admin to re-accept
    // the new `Members: Read` permission scope.
    if (
      err instanceof GithubHttpError &&
      (err.status === 401 || err.status === 403)
    ) {
      return NextResponse.json(
        {
          error:
            "GitHub denied the request. The org admin may need to re-accept the App's Members permission.",
        },
        { status: 403 }
      );
    }
    // Surface 429 as a real 429 with a Retry-After so callers can distinguish
    // rate-limit pressure from a generic GitHub outage and back off.
    if (err instanceof GithubHttpError && err.status === 429) {
      console.warn("[org-members] GitHub rate-limited the request", err);
      // TODO: Forward GitHub's Retry-After or x-ratelimit-reset once
      // GithubHttpError carries upstream response headers.
      return NextResponse.json(
        { error: "GitHub rate limited the request. Try again shortly." },
        { status: 429, headers: { "Retry-After": "60" } }
      );
    }
    // Log the full error (including GitHub's response body) server-side only;
    // return a generic message to the client so we don't forward GitHub's raw
    // diagnostics (which can include internal info) to the browser.
    console.error("[org-members] GitHub request failed", err);
    return NextResponse.json(
      { error: "GitHub request failed" },
      { status: 502 }
    );
  }
}
