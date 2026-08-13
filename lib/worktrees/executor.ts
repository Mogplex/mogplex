import { buildInternalApiHeaders } from "@/lib/internal-api-auth";
import type { WorktreeCommandResult } from "./types";

function resolveAppBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000")
  );
}

export async function executeWorktreeCommand(input: {
  userId: string;
  sandboxId: string;
  command: string;
  cwd?: string;
}): Promise<WorktreeCommandResult> {
  const response = await fetch(
    `${resolveAppBaseUrl()}/api/sandbox/${encodeURIComponent(input.sandboxId)}/exec`,
    {
      method: "POST",
      headers: buildInternalApiHeaders(input.userId),
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({ command: input.command, cwd: input.cwd }),
    }
  );
  const body = (await response.json().catch(() => ({}))) as {
    exitCode?: number | null;
    stdout?: string;
    stderr?: string;
    error?: string;
  };
  if (!response.ok) {
    throw new Error(body.error || body.stderr || "Worktree command failed");
  }
  return {
    exitCode: body.exitCode ?? null,
    stdout: body.stdout ?? "",
    stderr: body.stderr ?? "",
  };
}
