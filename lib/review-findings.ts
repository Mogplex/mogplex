import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { JobRunReviewFinding, ReviewFinding } from "@/lib/types";

function normalizeReviewFindingText(value: string) {
  return value.trim().replace(/\r\n/g, "\n");
}

function normalizeReviewFindingPath(path: string | null) {
  const trimmed = path?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function hasLinkedIssue(
  finding: JobRunReviewFinding | null | undefined
): finding is JobRunReviewFinding & {
  issue_number: number;
  issue_url: string;
} {
  return (
    finding?.status === "issue_created" &&
    finding.issue_number != null &&
    typeof finding.issue_url === "string" &&
    finding.issue_url.length > 0
  );
}

export function buildReviewFindingFingerprint(
  input: Pick<ReviewFinding, "severity" | "title" | "body" | "path" | "line">
) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        severity: input.severity,
        title: normalizeReviewFindingText(input.title),
        body: normalizeReviewFindingText(input.body),
        path: normalizeReviewFindingPath(input.path),
        line: typeof input.line === "number" ? input.line : null,
      })
    )
    .digest("hex");
}

export async function replaceJobRunReviewFindings(input: {
  userId: string;
  jobRunId: string;
  repoId: string | null;
  repoFullName: string | null;
  prNumber: number | null;
  headSha: string | null;
  findings: ReviewFinding[];
}) {
  "use step";

  const { error: deleteError } = await supabaseAdmin
    .from("review_findings")
    .delete()
    .eq("job_run_id", input.jobRunId);

  if (deleteError) {
    throw new Error(
      `Failed to clear existing review findings: ${deleteError.message}`
    );
  }

  if (input.findings.length === 0) {
    return {
      persisted: true as const,
      count: 0,
      error: null,
    };
  }

  const rows = input.findings.map((finding, index) => ({
    user_id: input.userId,
    job_run_id: input.jobRunId,
    repo_id: input.repoId,
    repo_full_name: input.repoFullName,
    pr_number: input.prNumber,
    head_sha: input.headSha,
    ordinal: index,
    fingerprint: buildReviewFindingFingerprint(finding),
    severity: finding.severity,
    title: normalizeReviewFindingText(finding.title),
    body: normalizeReviewFindingText(finding.body),
    path: normalizeReviewFindingPath(finding.path),
    line: typeof finding.line === "number" ? finding.line : null,
  }));

  const { error } = await supabaseAdmin.from("review_findings").insert(rows);

  if (error) {
    throw new Error(`Failed to persist review findings: ${error.message}`);
  }

  return {
    persisted: true as const,
    count: rows.length,
    error: null,
  };
}

export async function listJobRunReviewFindings(jobRunId: string) {
  const { data, error } = await supabaseAdmin
    .from("review_findings")
    .select("*")
    .eq("job_run_id", jobRunId)
    .order("ordinal", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load review findings: ${error.message}`);
  }

  return (data || []) as JobRunReviewFinding[];
}

export async function loadOwnedJobRunReviewFinding(input: {
  userId: string;
  jobRunId: string;
  findingId: string;
}) {
  const { data, error } = await supabaseAdmin
    .from("review_findings")
    .select("*")
    .eq("id", input.findingId)
    .eq("job_run_id", input.jobRunId)
    .eq("user_id", input.userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load review finding: ${error.message}`);
  }

  return (data as JobRunReviewFinding | null) ?? null;
}

export type ReviewFindingIssueClaimResult =
  | { outcome: "not_found"; finding: null }
  | { outcome: "claimed"; finding: JobRunReviewFinding }
  | { outcome: "linked"; finding: JobRunReviewFinding }
  | { outcome: "busy"; finding: JobRunReviewFinding };

export async function claimOwnedReviewFindingIssueCreation(input: {
  userId: string;
  jobRunId: string;
  findingId: string;
}): Promise<ReviewFindingIssueClaimResult> {
  const finding = await loadOwnedJobRunReviewFinding(input);
  if (!finding) {
    return { outcome: "not_found", finding: null };
  }

  if (hasLinkedIssue(finding)) {
    return { outcome: "linked", finding };
  }

  if (finding.status !== "open") {
    return { outcome: "busy", finding };
  }

  const claimedAt = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("review_findings")
    .update({
      status: "issue_creating",
      updated_at: claimedAt,
    })
    .eq("id", input.findingId)
    .eq("job_run_id", input.jobRunId)
    .eq("user_id", input.userId)
    .eq("status", "open")
    .eq("updated_at", finding.updated_at)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to claim review finding issue creation: ${error.message}`
    );
  }

  if (data) {
    return {
      outcome: "claimed",
      finding: data as JobRunReviewFinding,
    };
  }

  const current = await loadOwnedJobRunReviewFinding(input);
  if (!current) {
    return { outcome: "not_found", finding: null };
  }

  if (hasLinkedIssue(current)) {
    return { outcome: "linked", finding: current };
  }

  return { outcome: "busy", finding: current };
}

export async function releaseReviewFindingIssueCreationClaim(input: {
  findingId: string;
  issueNumber?: number | null;
  issueUrl?: string | null;
}) {
  const hasCreatedIssue =
    typeof input.issueNumber === "number" &&
    Number.isInteger(input.issueNumber) &&
    input.issueNumber > 0;

  const { error } = await supabaseAdmin
    .from("review_findings")
    .update({
      status: hasCreatedIssue ? "issue_created" : "open",
      issue_number: hasCreatedIssue ? input.issueNumber : null,
      issue_url: hasCreatedIssue ? (input.issueUrl ?? null) : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.findingId)
    .in(
      "status",
      hasCreatedIssue ? ["issue_creating", "issue_created"] : ["issue_creating"]
    );

  if (error) {
    throw new Error(
      `Failed to release review finding issue creation claim: ${error.message}`
    );
  }
}

export async function markReviewFindingIssueCreated(input: {
  findingId: string;
  issueNumber: number;
  issueUrl: string | null;
}) {
  const { data, error } = await supabaseAdmin
    .from("review_findings")
    .update({
      status: "issue_created",
      issue_number: input.issueNumber,
      issue_url: input.issueUrl,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.findingId)
    .eq("status", "issue_creating")
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to mark review finding issue as created: ${error.message}`
    );
  }

  if (!data) {
    throw new Error("Review finding issue claim is no longer active");
  }
}
