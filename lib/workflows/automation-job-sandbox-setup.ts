/**
 * Sandbox setup and launch helpers for the automation job workflow.
 * Split from automation-job-sandbox.ts for modularity.
 */

import { buildInternalApiHeaders } from "@/lib/internal-api-auth";
import type {
  JobContext,
  PullRequestDetails,
  AutomationSandboxRef,
} from "@/lib/workflows/automation-job-types";
import {
  readAutomationTeamId,
  extractSandboxRef,
  parseSseDataEvents,
  readTextResponse,
} from "@/lib/workflows/automation-job-utils";

export function buildAutofixSandboxInternalApiHeaders(
  context: Pick<JobContext, "metadata" | "repo">
) {
  return buildInternalApiHeaders(context.repo.user_id, {
    teamId: readAutomationTeamId(context.metadata),
  });
}

async function readJsonSandboxResponse(response: Response) {
  const payload = (await response.json()) as {
    sandbox?: unknown;
    error?: unknown;
  };
  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string"
        ? payload.error
        : "Sandbox launch failed"
    );
  }

  const sandbox = extractSandboxRef(payload.sandbox);
  if (!sandbox) {
    throw new Error("Sandbox launch response did not include a sandbox");
  }
  return sandbox;
}

async function readSandboxStreamResponse(response: Response) {
  if (!response.body) {
    throw new Error("Sandbox launch response did not include a stream");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let latestSandbox: AutomationSandboxRef | null = null;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSseDataEvents(buffer);
    buffer = parsed.remaining;

    for (const event of parsed.events) {
      if (!event || typeof event !== "object") continue;
      const typedEvent = event as {
        type?: string;
        message?: string;
        sandbox?: unknown;
      };
      if (typedEvent.type === "error") {
        throw new Error(typedEvent.message || "Sandbox launch failed");
      }
      const sandbox = extractSandboxRef(typedEvent.sandbox);
      if (sandbox) latestSandbox = sandbox;
      if (typedEvent.type === "ready" && latestSandbox) {
        return latestSandbox;
      }
    }
  }

  if (!latestSandbox) {
    throw new Error("Sandbox launch stream ended before a sandbox was ready");
  }
  return latestSandbox;
}

export async function launchAutofixSandbox(input: {
  context: JobContext;
  pullRequest: PullRequestDetails;
  targetRepo: JobContext["repo"];
}) {
  "use step";

  const { createSandboxPostHandler } = await import("@/app/api/sandbox/route");
  const response = await createSandboxPostHandler()(
    new Request("https://internal.mogplex/api/sandbox", {
      method: "POST",
      headers: buildAutofixSandboxInternalApiHeaders(input.context),
      body: JSON.stringify({
        repoId: input.targetRepo.id,
        baseBranch:
          input.pullRequest.baseRef ||
          input.targetRepo.default_branch ||
          input.context.repo.default_branch ||
          "main",
        workingBranch: input.pullRequest.headRef,
        createBranch: false,
      }),
    })
  );

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return readJsonSandboxResponse(response);
  }
  if (!response.ok) {
    throw new Error(
      (await readTextResponse(response)) || "Sandbox launch failed"
    );
  }
  return readSandboxStreamResponse(response);
}

export async function launchAutomationHarnessSandbox(context: JobContext) {
  "use step";

  const { createSandboxPostHandler } = await import("@/app/api/sandbox/route");
  const baseBranch = context.repo.default_branch || "main";
  const response = await createSandboxPostHandler()(
    new Request("https://internal.mogplex/api/sandbox", {
      method: "POST",
      headers: buildAutofixSandboxInternalApiHeaders(context),
      body: JSON.stringify({
        repoId: context.repo.id,
        baseBranch,
        workingBranch: baseBranch,
        createBranch: false,
      }),
    })
  );

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return readJsonSandboxResponse(response);
  }
  if (!response.ok) {
    throw new Error(
      (await readTextResponse(response)) || "Sandbox launch failed"
    );
  }
  return readSandboxStreamResponse(response);
}
