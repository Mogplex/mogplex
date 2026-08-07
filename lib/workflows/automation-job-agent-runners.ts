import { generateText, stepCountIs } from "ai";
import { buildPRFixTools, buildSandboxPRFixTools } from "@/lib/agents/pr-fixer";
import { buildPRReviewTools } from "@/lib/agents/pr-reviewer";
import { buildIssueTools } from "@/lib/agents/issue-tools";
import { buildCITools } from "@/lib/agents/ci-tools";
import { buildTagPushTools } from "@/lib/agents/tag-tools";
import { buildCommentTools } from "@/lib/agents/comment-tools";
import { buildRefactorTools } from "@/lib/agents/refactor";
import { loadOwnedSandboxRouteContext } from "@/lib/sandbox/route-context";
import { getEffectiveFlowAgentMaxSteps } from "@/lib/flows/agent-defaults";
import type { ReviewOutcome } from "@/lib/workflows/pr-review-harness";
import { executeAutomationTextGeneration } from "@/lib/workflows/automation-model-execution";
import {
  INVALID_PR_REVIEW_CONTEXT,
  type AutofixSandboxRecord,
  type AutomationAgentResult,
  type AutomationLanguageModel,
  type JobContext,
  type PullRequestDetails,
} from "@/lib/workflows/automation-job-types";
import {
  normalizeAutomationAssignmentType,
  splitRepoFullName,
} from "@/lib/workflows/automation-job-utils";
import { normalizeAutomationAgentResult } from "@/lib/workflows/automation-job-metadata";
import {
  buildPromptForJob,
  buildPromptForPRFix,
} from "@/lib/workflows/automation-job-prompts";
import { assertPullRequestGithubAccess } from "@/lib/workflows/automation-job-github";
import {
  buildAutofixSandboxInternalApiHeaders,
  launchAutofixSandbox,
} from "@/lib/workflows/automation-job-sandbox-setup";
import { resolvePullRequestNumber } from "@/lib/workflows/automation-job-sandbox-actions";
import {
  applyToolApprovalGate,
  buildAutomationGatewayContext,
  buildAutomationSystem,
  defaultAutomationAgentDeps,
  fallbackAutomationModel,
  type AutomationAgentDeps,
} from "@/lib/workflows/automation-job-agent-runners-shared";

// Re-export shared utilities for external consumers
export {
  buildAutomationGatewayContext,
  buildAutomationSystem,
  fallbackAutomationModel,
  getAutomationGatewayCaching,
  type AutomationAgentDeps,
} from "@/lib/workflows/automation-job-agent-runners-shared";

export function createAutomationAgentRunner(
  overrides: Partial<AutomationAgentDeps> = {}
) {
  const deps: AutomationAgentDeps = {
    ...defaultAutomationAgentDeps,
    ...overrides,
  };

  return async function runAutomationAgent(
    context: JobContext,
    githubToken: string,
    resolvedModel: AutomationLanguageModel = fallbackAutomationModel(
      context.agent.model,
      buildAutomationGatewayContext(context)
    )
  ): Promise<AutomationAgentResult> {
    "use step";

    const assignmentType = normalizeAutomationAssignmentType(
      context.assignmentType
    );
    const prReviewNumber =
      assignmentType === "pr_review"
        ? resolvePullRequestNumber(context.metadata)
        : null;
    const [owner, repoName] = context.repo.full_name.split("/");
    const headRepoFullName =
      typeof context.metadata.head_repo_full_name === "string"
        ? context.metadata.head_repo_full_name
        : context.repo.full_name;
    const headRepoParts = splitRepoFullName(headRepoFullName) ?? {
      owner,
      repo: repoName,
    };
    const baseBranch = context.repo.default_branch || "main";

    const tools =
      assignmentType === "cron_refactor" || assignmentType === "cron"
        ? buildRefactorTools({
            skillId: context.skillId || "general-refactor",
            githubToken,
            owner,
            repo: repoName,
            branch: baseBranch,
          })
        : assignmentType === "pr_review"
          ? (() => {
              if (prReviewNumber == null) {
                throw new Error(INVALID_PR_REVIEW_CONTEXT);
              }

              return buildPRReviewTools({
                githubToken,
                owner,
                repo: repoName,
                headOwner: headRepoParts.owner,
                headRepo: headRepoParts.repo,
                prNumber: prReviewNumber,
                defaultRef:
                  typeof context.metadata.head_ref === "string"
                    ? context.metadata.head_ref
                    : undefined,
                allowPostComment: false,
              });
            })()
          : assignmentType === "push_review"
            ? buildPRReviewTools({
                githubToken,
                owner,
                repo: repoName,
                headOwner: owner,
                headRepo: repoName,
                prNumber: 0,
                allowPostComment: true,
              })
            : assignmentType === "tag_push"
              ? // Tag runs get a dedicated toolset: PR tools would 404 on
                // prNumber 0, and file reads must default to the tag ref, not
                // a default branch that may have advanced past the tag.
                buildTagPushTools({
                  githubToken,
                  owner,
                  repo: repoName,
                  tagName:
                    typeof context.metadata.tag_name === "string"
                      ? context.metadata.tag_name
                      : "",
                })
              : assignmentType === "issue_triage"
                ? buildIssueTools({
                    githubToken,
                    owner,
                    repo: repoName,
                    issueNumber: context.metadata.issue_number as number,
                  })
                : assignmentType === "ci_failure"
                  ? buildCITools({
                      githubToken,
                      owner,
                      repo: repoName,
                      revert:
                        context.metadata.flow_auto_revert === true &&
                        typeof context.metadata.head_sha === "string" &&
                        context.metadata.head_sha.length > 0
                          ? {
                              failingSha: context.metadata.head_sha,
                              // Revert against the branch the failing commit
                              // was pushed to — CI failures fire for any ref,
                              // not just the default branch. The tool's
                              // head-sha check backstops the default-branch
                              // fallback for older jobs missing head_branch.
                              branch:
                                typeof context.metadata.head_branch ===
                                  "string" &&
                                context.metadata.head_branch.length > 0
                                  ? context.metadata.head_branch
                                  : baseBranch,
                            }
                          : undefined,
                    })
                  : assignmentType === "labeled"
                    ? (() => {
                        // Label on a PR gets the PR review toolset (file access +
                        // reportReview for structured findings + postComment);
                        // label on an issue gets the triage toolset.
                        const labeledPrNumber =
                          context.metadata.is_pr === true
                            ? resolvePullRequestNumber(context.metadata)
                            : null;
                        if (labeledPrNumber != null) {
                          return buildPRReviewTools({
                            githubToken,
                            owner,
                            repo: repoName,
                            headOwner: headRepoParts.owner,
                            headRepo: headRepoParts.repo,
                            prNumber: labeledPrNumber,
                            defaultRef:
                              typeof context.metadata.head_ref === "string"
                                ? context.metadata.head_ref
                                : undefined,
                            allowPostComment: true,
                          });
                        }
                        return buildIssueTools({
                          githubToken,
                          owner,
                          repo: repoName,
                          issueNumber: context.metadata.issue_number as number,
                        });
                      })()
                    : (() => {
                        const issueNumber = context.metadata.issue_number as
                          | number
                          | undefined;
                        if (!issueNumber) {
                          return buildPRReviewTools({
                            githubToken,
                            owner,
                            repo: repoName,
                            headOwner: owner,
                            headRepo: repoName,
                            prNumber: 0,
                            allowPostComment: true,
                          });
                        }
                        return buildCommentTools({
                          githubToken,
                          owner,
                          repo: repoName,
                          issueNumber,
                        });
                      })();

    if (assignmentType === "pr_review") {
      if (prReviewNumber == null) {
        throw new Error(INVALID_PR_REVIEW_CONTEXT);
      }

      await assertPullRequestGithubAccess({
        repoFullName: context.repo.full_name,
        prNumber: prReviewNumber,
        githubToken,
      });
    }

    const runSpec = buildPromptForJob(
      assignmentType,
      {
        ...context.metadata,
        repo_full_name: context.repo.full_name,
        base_branch: baseBranch,
        skill_id: context.skillId,
      },
      context.agent.system_prompt
    );
    const gatewayContext = buildAutomationGatewayContext(
      context,
      assignmentType
    );

    const { result, metadata } = await executeAutomationTextGeneration({
      phase: assignmentType,
      requestedModelId: resolvedModel.effectiveModelId,
      // What the graph pinned. Recorded only when it differs, so an upgraded run
      // is distinguishable from one always pinned to the successor.
      pinnedModelId: context.agent.model,
      generateText: deps.generateText,
      timeoutMs: context.agent.timeout_ms,
      request: {
        model: resolvedModel.model,
        providerOptions: resolvedModel.providerOptions,
        system: buildAutomationSystem(runSpec.system, gatewayContext),
        tools: applyToolApprovalGate(tools, context, deps),
        prompt: runSpec.prompt,
        stopWhen: stepCountIs(
          getEffectiveFlowAgentMaxSteps(context.agent.max_steps)
        ),
      },
    });

    return normalizeAutomationAgentResult({
      text: result.text,
      steps: result.steps,
      totalUsage: result.totalUsage,
      execution: metadata,
    });
  };
}

async function runPRFixAgentWithTools(input: {
  deps: AutomationAgentDeps;
  context: JobContext;
  review: ReviewOutcome;
  pullRequest: PullRequestDetails;
  targetRepo: JobContext["repo"];
  resolvedModel: AutomationLanguageModel;
  tools: NonNullable<Parameters<typeof generateText>[0]["tools"]>;
}) {
  const runSpec = buildPromptForPRFix(input);
  const gatewayContext = buildAutomationGatewayContext(input.context, "pr_fix");

  const { result, metadata } = await executeAutomationTextGeneration({
    phase: "pr_fix",
    requestedModelId: input.resolvedModel.effectiveModelId,
    pinnedModelId: input.context.agent.model,
    generateText: input.deps.generateText,
    timeoutMs: input.context.agent.timeout_ms,
    request: {
      model: input.resolvedModel.model,
      providerOptions: input.resolvedModel.providerOptions,
      tools: applyToolApprovalGate(input.tools, input.context, input.deps),
      system: buildAutomationSystem(undefined, gatewayContext),
      prompt: runSpec.prompt,
      stopWhen: stepCountIs(
        getEffectiveFlowAgentMaxSteps(input.context.agent.max_steps)
      ),
    },
  });

  return normalizeAutomationAgentResult({
    text: result.text,
    steps: result.steps,
    totalUsage: result.totalUsage,
    execution: metadata,
  });
}

export function createPRFixAgentRunner(
  overrides: Partial<AutomationAgentDeps> = {}
) {
  const deps: AutomationAgentDeps = {
    ...defaultAutomationAgentDeps,
    ...overrides,
  };

  return async function runPRFixAgent(
    input: {
      context: JobContext;
      review: ReviewOutcome;
      pullRequest: PullRequestDetails;
      targetRepo: JobContext["repo"];
    },
    githubToken: string,
    resolvedModel: AutomationLanguageModel = fallbackAutomationModel(
      input.context.agent.model,
      buildAutomationGatewayContext(input.context, "pr_fix")
    )
  ): Promise<AutomationAgentResult> {
    "use step";

    const [owner, repoName] = input.context.repo.full_name.split("/");
    const targetRepoParts = splitRepoFullName(input.targetRepo.full_name);
    if (!owner || !repoName) {
      throw new Error(`Invalid PR base repo: ${input.context.repo.full_name}`);
    }
    if (!targetRepoParts) {
      throw new Error(
        `Invalid autofix target repo: ${input.targetRepo.full_name}`
      );
    }

    return runPRFixAgentWithTools({
      deps,
      ...input,
      resolvedModel,
      tools: buildPRFixTools({
        githubToken,
        owner,
        repo: repoName,
        headOwner: targetRepoParts.owner,
        headRepo: targetRepoParts.repo,
        prNumber: input.pullRequest.number,
        branch: input.pullRequest.headRef,
      }),
    });
  };
}

export function createSandboxPRFixAgentRunner(
  overrides: Partial<AutomationAgentDeps> = {}
) {
  const deps: AutomationAgentDeps = {
    ...defaultAutomationAgentDeps,
    ...overrides,
  };

  return async function runPRFixAgentInSandbox(
    input: {
      context: JobContext;
      review: ReviewOutcome;
      pullRequest: PullRequestDetails;
      targetRepo: JobContext["repo"];
    },
    githubToken: string,
    resolvedModel: AutomationLanguageModel = fallbackAutomationModel(
      input.context.agent.model,
      buildAutomationGatewayContext(input.context, "pr_fix")
    )
  ): Promise<AutomationAgentResult> {
    "use step";

    const [owner, repoName] = input.context.repo.full_name.split("/");
    const targetRepoParts = splitRepoFullName(input.targetRepo.full_name);
    if (!owner || !repoName) {
      throw new Error(`Invalid PR base repo: ${input.context.repo.full_name}`);
    }
    if (!targetRepoParts) {
      throw new Error(
        `Invalid autofix target repo: ${input.targetRepo.full_name}`
      );
    }

    const sandboxRef = await launchAutofixSandbox(input);
    const sandboxData =
      await loadOwnedSandboxRouteContext<AutofixSandboxRecord>(
        new Request(
          `https://internal.mogplex/api/sandbox/${sandboxRef.recordId}/autofix`,
          {
            headers: buildAutofixSandboxInternalApiHeaders(input.context),
          }
        ),
        sandboxRef.recordId,
        {
          select:
            "repo_id, sandbox_id, root_directory, billing_source, billing_team_id, billing_project_id, vercel_team_id, vercel_project_id, preview_url, repo:repos(full_name, root_directory, sandbox_env_vars, env_sync_mode, vercel_project_id, vercel_team_id, github_installation_id)",
          hydrateSandboxClient: true,
        }
      );

    if (!sandboxData.ok) {
      throw new Error(sandboxData.error);
    }
    if (!sandboxData.sandbox) {
      throw new Error("Sandbox is not ready for autofix");
    }

    return runPRFixAgentWithTools({
      deps,
      ...input,
      resolvedModel,
      tools: buildSandboxPRFixTools({
        githubToken,
        owner,
        repo: repoName,
        headOwner: targetRepoParts.owner,
        headRepo: targetRepoParts.repo,
        prNumber: input.pullRequest.number,
        branch: input.pullRequest.headRef,
        sandbox: sandboxData.sandbox,
        rootDirectory: sandboxData.rootDirectory ?? null,
      }),
    });
  };
}
