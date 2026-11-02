import { controlMessageMetadata } from "@/lib/control/context-usage";
import type { createControlVerificationGate } from "@/lib/agents/orchestrator/checks/gate";
import type { ActiveControlCall } from "./types";

export function verificationMessageMetadata(input: {
  call: Pick<ActiveControlCall, "id" | "metadata">;
  model: string;
  verification: Pick<
    ReturnType<typeof createControlVerificationGate>,
    "metadata" | "interrupt"
  >;
}) {
  return ({
    part,
  }: {
    part: {
      type: string;
      usage?: { inputTokens?: number; outputTokens?: number };
    };
  }) => {
    if (part.type === "abort") input.verification.interrupt();
    const metadata =
      controlMessageMetadata(input.call.id, input.model, part) ??
      (part.type === "abort" ? { ai_call_id: input.call.id } : undefined);
    return metadata
      ? {
          ...metadata,
          repository_verification: input.verification.metadata(),
          workspace_changes: input.call.metadata.workspace_changes,
          workspace_snapshot_error:
            input.call.metadata.workspace_snapshot_error,
        }
      : undefined;
  };
}
