import type { ControlSessionRecord } from "@/lib/control/session-types";
import { getActiveTeamRequestHeaders } from "@/components/active-scope-provider";

export async function createControlSessionRecord(input: {
  title: string;
  project?: string;
  repoId?: string | null;
  request?: string;
  modelId?: string | null;
}): Promise<ControlSessionRecord | null> {
  const res = await fetch("/api/control/sessions", {
    method: "POST",
    headers: getActiveTeamRequestHeaders({
      "content-type": "application/json",
    }),
    body: JSON.stringify({
      title: input.title.slice(0, 80) || "New session",
      project: input.project?.trim() || null,
      repo_id: input.repoId || null,
      model_id: input.modelId ?? null,
      request: input.request?.trim() || input.title,
    }),
  });
  return res.ok ? ((await res.json()) as ControlSessionRecord) : null;
}
