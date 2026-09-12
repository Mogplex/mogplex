import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildInternalApiHeaders } from "@/lib/internal-api-auth";
import type { ExternalAgentRunRow } from "./runs-types";
import type { SandboxRef } from "./run-execution-launch";
import { readSandboxLaunchResponse } from "./run-execution-launch";

type ResumeSandboxDeps = {
  client: Pick<SupabaseClient, "from">;
  resume: (request: Request, recordId: string) => Promise<Response>;
};
const defaultDeps: ResumeSandboxDeps = {
  client: supabaseAdmin,
  resume: async (request, recordId) => {
    const { createSandboxResumeHandler } =
      await import("@/app/api/sandbox/[id]/resume/route");
    return createSandboxResumeHandler()(request, {
      params: Promise.resolve({ id: recordId }),
    });
  },
};

/** Resume the owned workspace; a missing snapshot must never become a fresh checkout. */
export async function resumeRunSandbox(
  run: ExternalAgentRunRow,
  deps: ResumeSandboxDeps = defaultDeps
): Promise<SandboxRef> {
  if (
    !run.sandbox_record_id ||
    !run.sandbox_id ||
    run.sandbox_id === "pending"
  ) {
    throw new Error(
      "This run has no saved workspace. Recover its recorded changes first."
    );
  }
  const { data: record, error } = await deps.client
    .from("sandboxes")
    .select("id,sandbox_id,status,persistent,product_team_id")
    .eq("id", run.sandbox_record_id)
    .eq("user_id", run.user_id)
    .eq("repo_id", run.repo_id)
    .maybeSingle();
  if (error || record?.sandbox_id !== run.sandbox_id)
    throw new Error(
      "The saved workspace is unavailable. Check its status in Sandboxes."
    );
  if (record.status === "running")
    return { recordId: record.id, sandboxId: record.sandbox_id };
  if (
    (record.status !== "paused" && record.status !== "stopped") ||
    record.persistent !== true
  )
    throw new Error(
      "The saved workspace cannot resume yet. Check its status in Sandboxes."
    );
  const response = await deps.resume(
    new Request("https://internal.mogplex/api/sandbox/resume", {
      method: "POST",
      headers: buildInternalApiHeaders(run.user_id, {
        teamId: record.product_team_id,
      }),
    }),
    record.id
  );
  return readSandboxLaunchResponse(response);
}
