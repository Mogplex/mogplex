import { getActiveTeamRequestHeaders } from "@/components/active-scope-provider";
import { useSandboxStore } from "@/hooks/use-sandbox";
import type { SandboxRecord } from "@/lib/types";

export async function reconcileSandbox(sandboxRecordId: string): Promise<void> {
  const response = await fetch(`/api/sandbox/${sandboxRecordId}/reconcile`, {
    method: "POST",
    headers: getActiveTeamRequestHeaders(),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : "Failed to reconcile sandbox";
    throw new Error(message);
  }

  if (
    payload &&
    typeof payload === "object" &&
    "sandbox" in payload &&
    payload.sandbox
  ) {
    useSandboxStore
      .getState()
      .setSandboxRecord(payload.sandbox as SandboxRecord);
  }
}
