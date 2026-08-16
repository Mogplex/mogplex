/**
 * Shared fixtures and helpers for automation-job-workflow tests.
 * This file is not a test file itself (no .test.ts suffix).
 */

export type CapturedConstructorOptions = {
  model?: string;
  system?:
    | string
    | { role: string; content: string; providerOptions?: unknown };
  tools?: unknown;
  prompt?: string;
};

export type CapturedGenerateTextOptions = {
  model?: string;
  system?:
    | string
    | { role: string; content: string; providerOptions?: unknown };
  tools?: unknown;
  prompt?: string;
  providerOptions?: {
    gateway?: {
      caching?: string;
      tags?: string[];
    };
  };
  stopWhen?: unknown;
  timeout?: number;
  maxRetries?: number;
};

export type CapturedAiCallInput = {
  status: "success" | "failed";
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number;
  toolCalls?: Array<{ name: string }>;
};

export type CapturedControlDispatchEvent = {
  outcome: "completed" | "failed" | "cancelled";
  reason: string | null | undefined;
  metadata: Record<string, unknown> | null | undefined;
};

export type CapturedPersistedReviewFindingsInput = {
  userId: string;
  jobRunId: string;
  repoId: string | null;
  repoFullName: string | null;
  prNumber: number | null;
  headSha: string | null;
  findings: Array<{
    severity: "critical" | "warning" | "suggestion";
    title: string;
    body: string;
    path: string | null;
    line: number | null;
  }>;
};

export async function loadAutomationJobWorkflowModule() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../../lib/workflows/automation-job-workflow");
}

export async function loadAiModelResolverModule() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../../lib/ai-model-resolver");
}

export function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

export function makeStep(input: {
  text?: string;
  inputTokens?: number;
  outputTokens?: number;
  toolCalls?: Array<{ toolName: string; input: unknown }>;
  toolResults?: unknown[];
}) {
  return {
    text: input.text ?? "",
    usage: {
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
    },
    toolCalls: input.toolCalls ?? [],
    toolResults: input.toolResults ?? [],
  };
}

export function makePersistedReviewFindingsResult(count = 0) {
  return {
    persisted: true as const,
    count,
    error: null,
  };
}

export function mockGithubPullRequestFetch(prNumbers: number[]) {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input) => {
    const url = typeof input === "string" ? input : input.toString();
    const match = url.match(
      /^https:\/\/api\.github\.com\/repos\/acme\/widgets\/pulls\/(\d+)$/
    );

    if (match) {
      const prNumber = Number(match[1]);
      if (prNumbers.includes(prNumber)) {
        return new Response(
          JSON.stringify({
            number: prNumber,
            title: `PR ${prNumber}`,
            body: null,
            head: {
              ref: "feature/test",
              sha: "abc123",
              repo: { full_name: "acme/widgets" },
            },
            base: {
              ref: "main",
              sha: "def456",
              repo: { full_name: "acme/widgets" },
            },
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          }
        );
      }
    }

    throw new Error(`Unexpected fetch during PR access test: ${url}`);
  }) as typeof fetch;

  return {
    mockedFetch: globalThis.fetch,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}
