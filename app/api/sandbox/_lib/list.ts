import { NextResponse } from "next/server";
import type { SandboxServiceCredentials } from "@/lib/sandbox/get-user-credentials";
import type { ActiveSandboxRecord, SandboxRouteResponseResult } from "./types";
import type { SandboxGetDeps } from "./deps";

export async function resolveSandboxListProductTeamId(input: {
  deps: Pick<SandboxGetDeps, "resolveActiveTeamCapabilities">;
  userId: string;
  activeTeamId: string | null;
}): Promise<SandboxRouteResponseResult | { productTeamId: string | null }> {
  if (!input.activeTeamId) return { productTeamId: null };

  const activeTeam = await input.deps.resolveActiveTeamCapabilities(
    input.userId,
    input.activeTeamId
  );
  if (!activeTeam.ok) {
    return {
      response: NextResponse.json(
        { error: activeTeam.error },
        { status: activeTeam.status }
      ),
    };
  }

  return { productTeamId: input.activeTeamId };
}

export async function reconcileStaleListedSandboxes(input: {
  deps: Pick<SandboxGetDeps, "findStaleActiveSandboxIds" | "stopSandboxRecord">;
  creds: SandboxServiceCredentials;
  sandboxes: ActiveSandboxRecord[];
}) {
  const active = input.sandboxes.filter(
    (sandbox) =>
      ["creating", "installing", "running"].includes(sandbox.status) &&
      sandbox.sandbox_id &&
      sandbox.sandbox_id !== "pending"
  );
  if (active.length === 0) return;

  const { staleIds } = await input.deps.findStaleActiveSandboxIds({
    sandboxCredentials: input.creds,
    records: active,
  });
  if (staleIds.size === 0) return;

  for (const staleId of staleIds) {
    await input.deps.stopSandboxRecord(staleId, { stopReason: "vm_gone" });
  }

  for (const sandbox of input.sandboxes) {
    if (staleIds.has(sandbox.id)) {
      sandbox.status = "stopped";
      sandbox.health_status = "stopped";
      sandbox.stop_reason = "vm_gone";
    }
  }
}
