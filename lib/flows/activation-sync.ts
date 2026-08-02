import { FlowServiceError } from "@/lib/flows/errors";

type FlowStatus = "active" | "inactive";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function syncScheduledFlowActivation(input: {
  previousStatus: FlowStatus;
  nextStatus: FlowStatus;
  scheduleId: string | null;
  setScheduleStatus: (scheduleId: string, status: FlowStatus) => Promise<void>;
  persistStatus: () => Promise<void>;
}) {
  if (input.scheduleId) {
    try {
      await input.setScheduleStatus(input.scheduleId, input.nextStatus);
    } catch (error) {
      throw new FlowServiceError(
        "FLOW_STORAGE_FAILED",
        `Failed to ${input.nextStatus === "active" ? "activate" : "pause"} the workflow schedule.`,
        { cause: error }
      );
    }
  }

  try {
    await input.persistStatus();
  } catch (persistError) {
    if (input.scheduleId) {
      try {
        await input.setScheduleStatus(input.scheduleId, input.previousStatus);
      } catch (rollbackError) {
        throw new FlowServiceError(
          "FLOW_ACTIVATION_ROLLBACK_FAILED",
          "Failed to update the flow status and restore the workflow schedule.",
          {
            cause: new AggregateError(
              [persistError, rollbackError],
              "Flow activation persistence and schedule rollback both failed"
            ),
          }
        );
      }
    }

    throw new FlowServiceError(
      "FLOW_STORAGE_FAILED",
      `Failed to update flow status: ${errorMessage(persistError)}`,
      { cause: persistError }
    );
  }
}
