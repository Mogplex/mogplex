export type FlowSaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

type FlowSaveStatusAnnouncementInput = {
  status: FlowSaveStatus;
  error: string | null;
  dirty: boolean;
  savedInSession: boolean;
};

export function flowSaveStatusAnnouncement({
  status,
  error,
  dirty,
  savedInSession,
}: FlowSaveStatusAnnouncementInput) {
  if (status === "error") {
    return `Save failed${error ? `: ${error}` : ""}`;
  }

  return status === "saved" && !dirty && savedInSession ? "Saved" : "";
}
