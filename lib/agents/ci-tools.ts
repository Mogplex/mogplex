import { tool } from "ai";
import { z } from "zod";
import { withAutomationMarker } from "@/lib/github-automation-marker";
import {
  createTextContextBudget,
  encodeGitHubContentPath,
  GITHUB_TEXT_CONTEXT_CHAR_LIMIT,
  readBoundedGitHubTextFile,
  type GitHubFileContent,
} from "@/lib/agents/github-file-content";

// Branch names are valid git refs but not valid URL path segments: characters
// like `#` or `?` would truncate the request path. Slashes are real path
// separators in ref URLs, so encode per segment rather than the whole name.
function encodeGitRefPath(branch: string) {
  return branch.split("/").map(encodeURIComponent).join("/");
}

// FNV-1a over the raw branch name. Sanitizing a branch for use in a ref name
// is not injective (`release/2.x` and `release-2.x` both sanitize to
// `release-2.x`), so the identity carries this digest to keep two different
// target branches from ever sharing a revert ref.
const FNV_OFFSET_BASIS = 2166136261; // 0x811c9dc5
const FNV_PRIME = 16777619; // 0x01000193

function branchDigest(branch: string) {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < branch.length; i += 1) {
    hash ^= branch.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

// Git enforces a byte limit (~255) on each ref path component. The sanitized
// branch is display-only context — identity comes from the SHA prefix and the
// digest — so it is safe to truncate. 80 keeps the whole leaf component
// ("revert-" + 12-char SHA + separators + base + 8-char digest) far under the
// limit, and sanitization leaves only ASCII, so slice() is byte-exact.
const MAX_SANITIZED_BASE_LENGTH = 80;

// The revert-branch identity must be unique per (failing commit, target
// branch): the same commit can be the head of several branches at once, and
// each needs its own revert PR against its own base. A 12-char SHA keeps
// short-prefix collisions out of the identity; the digest disambiguates
// branches whose sanitized names collide or differ only past the truncation
// point.
export function buildRevertBranchName(failingSha: string, branch: string) {
  const sanitizedBase = branch
    .replace(/[^\w.-]+/g, "-")
    .slice(0, MAX_SANITIZED_BASE_LENGTH);
  return `mogplex/revert-${failingSha.slice(0, 12)}-${sanitizedBase}-${branchDigest(branch)}`;
}

export function buildCITools(config: {
  githubToken: string;
  owner: string;
  repo: string;
  // When set, expose createRevertPr for this commit. Opt-in per flow node
  // (autoRevert); absent for legacy assignment-based CI jobs. `branch` is the
  // branch the failing commit was pushed to — the head check, revert, and PR
  // base all target it.
  revert?: {
    failingSha: string;
    branch: string;
  };
}) {
  const headers = {
    Authorization: `Bearer ${config.githubToken}`,
    "Content-Type": "application/json",
  };
  const textBudget = createTextContextBudget(GITHUB_TEXT_CONTEXT_CHAR_LIMIT);

  const tools = {
    fetchWorkflowLogs: tool({
      description: "Fetch the logs for a failed workflow run or check run",
      inputSchema: z.object({
        runId: z.number().describe("The workflow run ID"),
      }),
      execute: async ({ runId }) => {
        // First get the jobs for this run
        const jobsRes = await fetch(
          `https://api.github.com/repos/${config.owner}/${config.repo}/actions/runs/${runId}/jobs`,
          { headers }
        );
        if (!jobsRes.ok) throw new Error(`GitHub API ${jobsRes.status}`);
        const jobsData = await jobsRes.json();

        const failedJobs =
          jobsData.jobs?.filter(
            (j: { conclusion: string }) => j.conclusion === "failure"
          ) ?? [];

        // Get logs for each failed job's failed steps
        return failedJobs.map(
          (job: {
            name: string;
            steps: { name: string; conclusion: string }[];
          }) => ({
            name: job.name,
            failedSteps:
              job.steps
                ?.filter((s) => s.conclusion === "failure")
                .map((s) => s.name) ?? [],
          })
        );
      },
    }),
    fetchFile: tool({
      description: "Fetch file content from the repository at a specific ref",
      inputSchema: z.object({
        path: z.string(),
        ref: z.string().optional().describe("Git ref (branch, tag, or SHA)"),
      }),
      execute: async ({ path, ref }) => {
        const url = new URL(
          `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${encodeGitHubContentPath(path)}`
        );
        if (ref) url.searchParams.set("ref", ref);
        const res = await fetch(url.toString(), { headers });
        if (!res.ok) throw new Error(`GitHub API ${res.status}: ${path}`);
        return readBoundedGitHubTextFile(
          textBudget,
          (await res.json()) as GitHubFileContent | GitHubFileContent[],
          path
        );
      },
    }),
    postCommitComment: tool({
      description: "Post a comment on a specific commit",
      inputSchema: z.object({
        sha: z.string(),
        body: z.string(),
      }),
      execute: async ({ sha, body }) => {
        const res = await fetch(
          `https://api.github.com/repos/${config.owner}/${config.repo}/commits/${sha}/comments`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({ body: withAutomationMarker(body) }),
          }
        );
        if (!res.ok)
          return { success: false, error: `GitHub API ${res.status}` };
        return { success: true };
      },
    }),
    createIssue: tool({
      description: "Create a new issue to track a CI failure",
      inputSchema: z.object({
        title: z.string(),
        body: z.string(),
        labels: z.array(z.string()).optional(),
      }),
      execute: async ({ title, body, labels }) => {
        const res = await fetch(
          `https://api.github.com/repos/${config.owner}/${config.repo}/issues`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({ title, body, labels: labels ?? [] }),
          }
        );
        if (!res.ok)
          return { success: false, error: `GitHub API ${res.status}` };
        const data = await res.json();
        return { success: true, issue_number: data.number, url: data.html_url };
      },
    }),
  };

  if (!config.revert) {
    return tools;
  }

  const revert = config.revert;
  return {
    ...tools,
    createRevertPr: tool({
      description:
        "Open a revert PR for the commit that broke CI. Only works while that commit is still the branch head; never pushes to the branch directly.",
      inputSchema: z.object({
        reason: z
          .string()
          .describe("Short explanation of why the commit is being reverted"),
      }),
      execute: async ({ reason }) => {
        const shortShaEarly = revert.failingSha.slice(0, 7);
        const branchName = buildRevertBranchName(
          revert.failingSha,
          revert.branch
        );

        // One lookup, used at three points: the initial precheck, the 422
        // ref-collision path, and the PR-creation failure path. Concurrent
        // deliveries can interleave anywhere between those points, so each
        // mutation decision re-verifies against the live PR list instead of
        // trusting an earlier answer.
        const lookupUrl = `https://api.github.com/repos/${config.owner}/${config.repo}/pulls?head=${encodeURIComponent(`${config.owner}:${branchName}`)}&base=${encodeURIComponent(revert.branch)}&state=open`;
        const findOpenRevertPr = async (): Promise<
          | { ok: true; pr: { number: number; html_url: string } | null }
          | { ok: false; status: number }
        > => {
          const res = await fetch(lookupUrl, { headers });
          if (!res.ok) return { ok: false, status: res.status };
          const list = (await res.json()) as Array<{
            number: number;
            html_url: string;
            base?: { ref?: string };
          }>;
          return {
            ok: true,
            pr: list.find((pr) => pr.base?.ref === revert.branch) ?? null,
          };
        };
        const reusedResult = (pr: { number: number; html_url: string }) => ({
          success: true,
          pr_number: pr.number,
          url: pr.html_url,
          reused: true,
        });

        // Idempotency: a prior call may have created the branch and/or PR and
        // then failed partway (or this is a webhook redelivery). Reuse an
        // existing open revert PR instead of failing on the ref collision —
        // but only one whose base is this target branch. This lookup must
        // fail closed: proceeding on an unverified "no PR" answer would let
        // the 422 repoint path below force-move a branch that may already
        // back an open revert PR.
        const precheck = await findOpenRevertPr();
        if (!precheck.ok) {
          return {
            success: false,
            error: `GitHub API ${precheck.status}: could not verify whether a revert PR already exists; aborting before any change. Retry once GitHub is reachable.`,
          };
        }
        if (precheck.pr) {
          return reusedResult(precheck.pr);
        }

        // A tree-swap revert is only exact for the branch head: replacing the
        // tree of any older commit would also wipe every commit after it.
        const branchRes = await fetch(
          `https://api.github.com/repos/${config.owner}/${config.repo}/git/ref/heads/${encodeGitRefPath(revert.branch)}`,
          { headers }
        );
        if (!branchRes.ok) {
          return {
            success: false,
            error: `GitHub API ${branchRes.status}: read branch head`,
          };
        }
        const branchData = (await branchRes.json()) as {
          object?: { sha?: string };
        };
        const headSha = branchData.object?.sha;
        if (headSha !== revert.failingSha) {
          return {
            success: false,
            error: `Branch ${revert.branch} has moved past ${revert.failingSha.slice(0, 7)} (now at ${String(headSha).slice(0, 7)}); a safe automated revert is no longer possible. Create an issue instead.`,
          };
        }

        const commitRes = await fetch(
          `https://api.github.com/repos/${config.owner}/${config.repo}/git/commits/${revert.failingSha}`,
          { headers }
        );
        if (!commitRes.ok) {
          return {
            success: false,
            error: `GitHub API ${commitRes.status}: read failing commit`,
          };
        }
        const commitData = (await commitRes.json()) as {
          message?: string;
          parents?: Array<{ sha: string }>;
        };
        const parentSha = commitData.parents?.[0]?.sha;
        if (!parentSha || (commitData.parents?.length ?? 0) !== 1) {
          return {
            success: false,
            error:
              "The failing commit has zero or multiple parents (root or merge commit); a safe automated revert is not possible.",
          };
        }

        const parentRes = await fetch(
          `https://api.github.com/repos/${config.owner}/${config.repo}/git/commits/${parentSha}`,
          { headers }
        );
        if (!parentRes.ok) {
          return {
            success: false,
            error: `GitHub API ${parentRes.status}: read parent commit`,
          };
        }
        const parentData = (await parentRes.json()) as {
          tree?: { sha?: string };
        };
        if (!parentData.tree?.sha) {
          return { success: false, error: "Parent commit has no tree" };
        }

        const shortSha = shortShaEarly;
        const firstLine = (commitData.message ?? "").split("\n")[0];
        const revertCommitRes = await fetch(
          `https://api.github.com/repos/${config.owner}/${config.repo}/git/commits`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              message: `Revert "${firstLine}"\n\nThis reverts commit ${revert.failingSha}.\n\n${reason}`,
              tree: parentData.tree.sha,
              parents: [revert.failingSha],
            }),
          }
        );
        if (!revertCommitRes.ok) {
          return {
            success: false,
            error: `GitHub API ${revertCommitRes.status}: create revert commit`,
          };
        }
        const revertCommit = (await revertCommitRes.json()) as { sha: string };

        let refCreatedByThisCall = false;
        const refRes = await fetch(
          `https://api.github.com/repos/${config.owner}/${config.repo}/git/refs`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              ref: `refs/heads/${branchName}`,
              sha: revertCommit.sha,
            }),
          }
        );
        if (refRes.ok) {
          refCreatedByThisCall = true;
        } else if (refRes.status === 422) {
          // The ref already exists: either a leftover from a failed prior
          // attempt, or a concurrent delivery created it after our precheck
          // and may be opening its PR right now. Re-verify before touching
          // it — force-repointing a ref that now backs an open PR would
          // hijack that PR's head. Fail closed if we cannot verify.
          const recheck = await findOpenRevertPr();
          if (!recheck.ok) {
            return {
              success: false,
              error: `GitHub API ${recheck.status}: could not verify ownership of the existing revert branch; aborting without touching it. Retry once GitHub is reachable.`,
            };
          }
          if (recheck.pr) {
            return reusedResult(recheck.pr);
          }
          // A 422 can also mean GitHub rejected the ref name itself, not that
          // the ref exists. Only repoint a ref that verifiably exists —
          // otherwise report the creation failure instead of masking it
          // behind a doomed PATCH.
          const refExistsRes = await fetch(
            `https://api.github.com/repos/${config.owner}/${config.repo}/git/ref/heads/${encodeGitRefPath(branchName)}`,
            { headers }
          );
          if (!refExistsRes.ok) {
            return {
              success: false,
              error: `GitHub API 422: could not create revert branch ${branchName}, and no such branch exists to reuse — the generated ref name was likely rejected as invalid.`,
            };
          }
          // Existence alone does not prove the ref is ours: the name is
          // predictable, so a user or another integration may own a branch
          // there. Only proceed when its tip is verifiably the tree-swap
          // revert this call would have produced (sole parent = the failing
          // commit, tree = the parent's tree) — and then reuse that tip
          // as-is. Never force-overwrite a branch this call cannot prove it
          // owns.
          const refExistsData = (await refExistsRes.json()) as {
            object?: { sha?: string };
          };
          const leftoverTipSha = refExistsData.object?.sha;
          const tipRes = leftoverTipSha
            ? await fetch(
                `https://api.github.com/repos/${config.owner}/${config.repo}/git/commits/${leftoverTipSha}`,
                { headers }
              )
            : null;
          const tip = tipRes?.ok
            ? ((await tipRes.json()) as {
                parents?: Array<{ sha: string }>;
                tree?: { sha?: string };
              })
            : null;
          const tipIsExpectedRevert =
            tip !== null &&
            tip.parents?.length === 1 &&
            tip.parents[0]?.sha === revert.failingSha &&
            tip.tree?.sha === parentData.tree.sha;
          if (!tipIsExpectedRevert) {
            return {
              success: false,
              error: `Branch ${branchName} already exists but its tip is not the expected revert of ${shortShaEarly}; refusing to overwrite a branch this automation cannot verify it owns. Delete or rename that branch and retry.`,
            };
          }
          // Fall through to PR creation against the verified leftover tip.
        } else {
          return {
            success: false,
            error: `GitHub API ${refRes.status}: create revert branch`,
          };
        }

        const prRes = await fetch(
          `https://api.github.com/repos/${config.owner}/${config.repo}/pulls`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              title: `Revert "${firstLine}"`,
              head: branchName,
              base: revert.branch,
              body: withAutomationMarker(
                `Reverts ${shortSha}, which broke CI.\n\n${reason}`
              ),
            }),
          }
        );
        if (!prRes.ok) {
          // A concurrent delivery may have won the race: it repointed the ref
          // and opened its PR first, which is exactly what makes this POST
          // fail with 422. Deleting the ref here would orphan that PR —
          // re-check and reuse it instead.
          const recheck = await findOpenRevertPr();
          if (recheck.ok && recheck.pr) {
            return reusedResult(recheck.pr);
          }
          // Clean up the stale branch only with proof of sole ownership: the
          // recheck confirmed no open PR, this call created the ref, and the
          // ref still points at the exact commit this call created (any other
          // SHA means a concurrent delivery repointed it and owns it now).
          // Skipping cleanup is always safe — a stale branch degrades to the
          // 422 path on retry; an orphaned PR does not recover.
          if (refCreatedByThisCall && recheck.ok) {
            const refCheckRes = await fetch(
              `https://api.github.com/repos/${config.owner}/${config.repo}/git/ref/heads/${encodeGitRefPath(branchName)}`,
              { headers }
            ).catch(() => null);
            const refCheck = refCheckRes?.ok
              ? ((await refCheckRes.json()) as { object?: { sha?: string } })
              : null;
            if (refCheck?.object?.sha === revertCommit.sha) {
              await fetch(
                `https://api.github.com/repos/${config.owner}/${config.repo}/git/refs/heads/${encodeGitRefPath(branchName)}`,
                { method: "DELETE", headers }
              ).catch(() => undefined);
            }
          }
          return {
            success: false,
            error: `GitHub API ${prRes.status}: create revert PR`,
          };
        }
        const pr = (await prRes.json()) as {
          number: number;
          html_url: string;
        };
        return { success: true, pr_number: pr.number, url: pr.html_url };
      },
    }),
  };
}
