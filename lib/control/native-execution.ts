import { createNativeSandboxExecution } from "@/lib/mogplex-api/native-sandbox-execution";
import { updateAiCallIfActive } from "@/lib/interactive-runs";
import type { ActiveControlCall } from "@/app/api/control/chat/_lib/types";

export function createControlNativeExecution(
  call: ActiveControlCall,
  teamId: string | null,
  signal: AbortSignal
) {
  return createNativeSandboxExecution(
    call.user_id,
    teamId,
    {
      onCommandStarted: async ({ sandboxId, commandId }) => {
        call.runtime_command_id = commandId;
        call.metadata = { ...call.metadata, sandbox_record_id: sandboxId };
        const updated = await updateAiCallIfActive(call.id, {
          runtime_command_id: commandId,
          metadata: call.metadata,
        });
        if (!updated)
          throw new Error(
            "The agent was stopped before command ownership could be saved."
          );
      },
      onCommandFinished: async (commandId) => {
        if (call.runtime_command_id !== commandId) return;
        call.runtime_command_id = null;
        await updateAiCallIfActive(call.id, { runtime_command_id: null });
      },
    },
    signal
  );
}
