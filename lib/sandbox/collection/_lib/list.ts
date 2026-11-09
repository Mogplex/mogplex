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
      sandbox.status === "running" &&
      sandbox.sandbox_id &&
      sandbox.sandbox_id !== "pending"
  );
  if (active.length === 0) return false;

  const { staleIds } = await input.deps.findStaleActiveSandboxIds({
    sandboxCredentials: input.creds,
    records: active,
  });
  if (staleIds.size === 0) return false;

  let conflicted = false;
  for (const sandbox of active) {
    if (!staleIds.has(sandbox.id)) continue;
    const stopped = await input.deps.stopSandboxRecord(sandbox.id, {
      expectedSandboxId: sandbox.sandbox_id,
      fromStatuses: "running",
      expectedLastBootStartedAt: sandbox.last_boot_started_at ?? null,
      stopReason: "vm_gone",
    });
    if (stopped) {
      sandbox.status = "stopped";
      sandbox.health_status = "stopped";
      sandbox.stop_reason = "vm_gone";
    } else {
      conflicted = true;
    }
  }
  return conflicted;
}
