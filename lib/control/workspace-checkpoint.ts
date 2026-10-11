import { buildInternalApiHeaders } from "@/lib/internal-api-auth";
import { redactSecretsInValue } from "@/lib/ai-telemetry";
import { mergeAiCallMetadata } from "@/lib/interactive-runs";
import { workspaceSnapshotSchema } from "./workspace-snapshot";
import type { ActiveControlCall } from "@/app/api/control/chat/_lib/types";

export function createWorkspaceCheckpoint(
  call: ActiveControlCall,
  binding: { sandboxId: string | null; status: string },
  teamId: string | null
) {
  return async (toolName: string) => {
    if (
      !binding.sandboxId ||
      binding.status !== "running" ||
      !["run_command", "write_file", "edit_file", "sandbox_stop"].includes(
        toolName
      )
    )
      return;
    try {
      const { GET } = await import("@/app/api/sandbox/[id]/changes/route");
      const response = await GET(
        new Request(
          `https://internal.mogplex/api/sandbox/${binding.sandboxId}/changes?snapshot=1`,
          { headers: buildInternalApiHeaders(call.user_id, { teamId }) }
        ),
        { params: Promise.resolve({ id: binding.sandboxId }) }
      );
      if (!response.ok) throw new Error("Could not inspect workspace changes.");
      const result = await response.json();
      const snapshot = workspaceSnapshotSchema.parse({
        sandboxId: binding.sandboxId,
        capturedAt: new Date().toISOString(),
        files: result.files,
      });
      const metadata = {
        workspace_changes: redactSecretsInValue(snapshot),
        sandbox_id: binding.sandboxId,
        workspace_snapshot_error: null,
      };
      call.metadata = { ...call.metadata, ...metadata };
      await mergeAiCallMetadata({
        userId: call.user_id,
        aiCallId: call.id,
        metadata,
      });
    } catch {
      const metadata = {
        workspace_snapshot_error:
          "The latest workspace changes could not be inspected. The saved diff may be older than the last command.",
      };
      call.metadata = { ...call.metadata, ...metadata };
      await mergeAiCallMetadata({
        userId: call.user_id,
        aiCallId: call.id,
        metadata,
      });
    }
  };
}
