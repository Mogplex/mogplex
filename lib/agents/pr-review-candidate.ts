import { generateText, stepCountIs } from "ai";
import { z } from "zod";
import { getEffectiveFlowAgentMaxSteps } from "@/lib/flows/agent-defaults";
import { withGatewaySystemCaching } from "@/lib/models/gateway-provider-routing";
import { buildPRReviewTools } from "@/lib/agents/pr-reviewer";
import { buildPrReviewRunSpec } from "@/lib/agents/pr-review-run-spec";
import { executeAutomationTextGeneration } from "@/lib/workflows/automation-model-execution";
import { extractPrReviewHarnessResult } from "@/lib/workflows/pr-review-harness";

export const REFERENCE_PR_REVIEW_SYSTEM_PROMPT = `You are the reference Mogplex pull request reviewer used for release qualification.

Find concrete, material defects introduced by the diff. Review correctness, authorization and tenant isolation, secret handling, idempotency and concurrency, migration and rollout compatibility, cancellation boundaries, error handling and observability, public contracts, and missing behavioral tests. Do not report style preferences or speculative issues. A clean change must receive no findings.

Use critical for authorization bypasses, secret disclosure, destructive boundary failures, data corruption, and changes that break the deployed application. Use warning for other material correctness, reliability, race, and observability defects. Use suggestion only for concrete non-blocking improvements.`;

const changedFileSchema = z
  .object({
    path: z.string().trim().min(1),
    patch: z.string().min(1),
    content: z.string().optional(),
  })
  .strict();

export const prReviewCandidateInputSchema = z
  .object({
    schemaVersion: z.literal(1),
    caseId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    suite: z.literal("pr-review"),
    input: z
      .object({
        pullRequest: z
          .object({
            title: z.string().trim().min(1),
            body: z.string(),
          })
          .strict(),
        changedFiles: z.array(changedFileSchema).min(1),
      })
      .strict(),
  })
  .strict();

export type PrReviewCandidateInput = z.infer<
  typeof prReviewCandidateInputSchema
>;

type CandidateModel = Parameters<typeof generateText>[0]["model"];
type CandidateProviderOptions = Parameters<
  typeof generateText
>[0]["providerOptions"];

export type PrReviewCandidateResult = {
  suite: "pr-review";
  caseId: string;
  status: "completed" | "failed";
  hasIssues: boolean;
  summary: string;
  findings: Array<{
    severity: "critical" | "warning" | "suggestion";
    title: string;
    body: string;
    path?: string;
    line?: number;
  }>;
  metadata: {
    modelId: string;
    durationMs: number;
    inputTokens: number | null;
    outputTokens: number | null;
    execution: Record<string, unknown>;
  };
};

function countPatchLines(patch: string, prefix: "+" | "-") {
  return patch.split(/\r?\n/).filter((line) => {
    const isFileHeader =
      prefix === "+" ? line.startsWith("+++ ") : line.startsWith("--- ");
    return line.startsWith(prefix) && !isFileHeader;
  }).length;
}

function isGitPatchMetadataLine(line: string) {
  return [
    "diff --git ",
    "index ",
    "new file mode ",
    "deleted file mode ",
    "similarity index ",
    "rename from ",
    "rename to ",
  ].some((prefix) => line.startsWith(prefix));
}

function reconstructFileFromPatch(patch: string) {
  const lines = patch
    .split(/\r?\n/)
    .filter(
      (line) =>
        !line.startsWith("-") &&
        !line.startsWith("+++ ") &&
        !line.startsWith("@@") &&
        line !== "\\ No newline at end of file" &&
        !isGitPatchMetadataLine(line)
    )
    .map((line) =>
      line.startsWith("+") || line.startsWith(" ") ? line.slice(1) : line
    );
  return [
    "// Synthetic quality fixture reconstructed from the candidate-visible patch.",
    ...lines,
  ].join("\n");
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function createPrReviewCandidateGithubFetch(
  candidate: PrReviewCandidateInput
): typeof fetch {
  const files = new Map(
    candidate.input.changedFiles.map((file) => [file.path, file] as const)
  );

  return async (request) => {
    const url = new URL(
      typeof request === "string"
        ? request
        : request instanceof URL
          ? request.href
          : request.url
    );
    if (url.origin !== "https://api.github.com") {
      throw new Error(`Candidate GitHub transport rejected ${url.origin}`);
    }

    if (url.pathname === "/repos/mogplex-quality/candidate/pulls/1") {
      return jsonResponse({
        number: 1,
        title: candidate.input.pullRequest.title,
        body: candidate.input.pullRequest.body,
        html_url: "https://github.invalid/mogplex-quality/candidate/pull/1",
        head: { ref: "quality-head", sha: "1".repeat(40) },
        base: { ref: "main", sha: "0".repeat(40) },
      });
    }

    if (url.pathname === "/repos/mogplex-quality/candidate/pulls/1/files") {
      return jsonResponse(
        candidate.input.changedFiles.map((file) => ({
          filename: file.path,
          status: "modified",
          additions: countPatchLines(file.patch, "+"),
          deletions: countPatchLines(file.patch, "-"),
          changes:
            countPatchLines(file.patch, "+") + countPatchLines(file.patch, "-"),
          patch: file.patch,
        }))
      );
    }

    const contentPrefix = "/repos/mogplex-quality/candidate/contents/";
    if (url.pathname.startsWith(contentPrefix)) {
      const path = url.pathname
        .slice(contentPrefix.length)
        .split("/")
        .map(decodeURIComponent)
        .join("/");
      const file = files.get(path);
      if (!file) return jsonResponse({ message: "Not Found" }, 404);
      const content = file.content ?? reconstructFileFromPatch(file.patch);
      return jsonResponse({
        type: "file",
        encoding: "base64",
        size: Buffer.byteLength(content),
        content: Buffer.from(content).toString("base64"),
      });
    }

    return jsonResponse({ message: "Not Found" }, 404);
  };
}

export async function runPrReviewCandidate(
  rawInput: unknown,
  options: {
    model: CandidateModel;
    modelId: string;
    providerOptions?: CandidateProviderOptions;
    generateText?: typeof generateText;
    maxSteps?: number;
    systemPrompt?: string;
    timeoutMs?: number;
  }
): Promise<PrReviewCandidateResult> {
  const candidate = prReviewCandidateInputSchema.parse(rawInput);
  const startedAt = Date.now();
  const runSpec = buildPrReviewRunSpec({
    prNumber: 1,
    systemPrompt: options.systemPrompt ?? REFERENCE_PR_REVIEW_SYSTEM_PROMPT,
  });
  const githubFetch = createPrReviewCandidateGithubFetch(candidate);
  const tools = buildPRReviewTools({
    fetch: githubFetch,
    githubToken: "candidate-fixture",
    owner: "mogplex-quality",
    repo: "candidate",
    headOwner: "mogplex-quality",
    headRepo: "candidate",
    prNumber: 1,
    defaultRef: "quality-head",
  });

  const { result, metadata } = await executeAutomationTextGeneration({
    phase: "quality_pr_review",
    requestedModelId: options.modelId,
    generateText: options.generateText ?? generateText,
    timeoutMs: options.timeoutMs,
    request: {
      model: options.model,
      providerOptions: options.providerOptions,
      system: withGatewaySystemCaching(runSpec.system, {
        userId: "mogplex-quality",
        caching: "auto",
        tags: ["surface:quality", "type:pr_review"],
      }),
      tools,
      prompt: runSpec.prompt,
      stopWhen: stepCountIs(
        getEffectiveFlowAgentMaxSteps(options.maxSteps ?? 20)
      ),
    },
  });
  const harnessResult = extractPrReviewHarnessResult({
    text: result.text,
    steps: result.steps.map((step) => ({
      toolCalls: step.toolCalls.map((toolCall) => ({
        toolName: toolCall.toolName,
        input: toolCall.input,
      })),
      toolResults: step.toolResults,
    })),
  });
  const candidateMetadata = {
    modelId: options.modelId,
    durationMs: Date.now() - startedAt,
    inputTokens: result.totalUsage.inputTokens ?? null,
    outputTokens: result.totalUsage.outputTokens ?? null,
    execution: metadata as unknown as Record<string, unknown>,
  };
  if (harnessResult.source !== "structured") {
    return {
      suite: "pr-review",
      caseId: candidate.caseId,
      status: "failed",
      hasIssues: false,
      summary: "Candidate did not return structured reportReview output.",
      findings: [],
      metadata: candidateMetadata,
    };
  }

  return {
    suite: "pr-review",
    caseId: candidate.caseId,
    status: "completed",
    hasIssues: harnessResult.reviewOutcome.hasIssues,
    summary: harnessResult.reviewOutcome.summary,
    findings: harnessResult.reviewOutcome.findings.map((finding) => ({
      severity: finding.severity,
      title: finding.title,
      body: finding.body,
      ...(finding.path ? { path: finding.path } : {}),
      ...(finding.line ? { line: finding.line } : {}),
    })),
    metadata: candidateMetadata,
  };
}
