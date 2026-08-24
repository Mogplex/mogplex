import { NextResponse } from "next/server";
import { isSandboxCapabilityDeniedError } from "@/lib/sandbox/get-user-credentials";
import { readActiveTeamIdHeader } from "@/lib/team-capabilities";
import { toSandboxClientRecord } from "@/lib/sandbox/summary";
import { CLI_VISIBLE_STATUSES } from "./_lib/constants";
import { toWorkspace, type CliSandboxRecord } from "./_lib/types";
import {
  toCliSandboxRecord,
  readSandboxFormat,
  resolveEffectiveTimeoutFromActiveRecord,
} from "./_lib/response-shaping";
import {
  defaultSandboxPostDeps,
  defaultSandboxGetDeps,
  type SandboxPostDeps,
  type SandboxGetDeps,
} from "./_lib/deps";
import {
  prepareSandboxLaunch,
  maybeReturnExistingSandboxResponse,
  maybeReturnNameCollisionResponse,
  claimSandboxBootLimitOrResponse,
  insertPendingSandboxLaunchRecord,
  buildSandboxLaunchStreamResponse,
} from "./_lib/launch";
import {
  resolveSandboxListProductTeamId,
  reconcileStaleListedSandboxes,
} from "./_lib/list";

// The deployment target supports this ceiling. Ordinary POSTs still return as
// soon as their work completes; only an opted-in Neon-notified readiness wait
// can approach ten minutes. Leave room for request setup and teardown.
export const maxDuration = 800;

// Re-export functions that tests depend on
export {
  shouldQueueSnapshotWarmupOnSandboxLaunch,
  summarizeDeferredSnapshotWarmupQueueResult,
} from "./_lib/snapshot-warmup";
export {
  classifySandboxLaunchFailure,
  shouldLoadSandboxLaunchFailureDiagnostics,
} from "./_lib/failure-handling";
export { toStreamStatusSandboxRecord } from "./_lib/response-shaping";
export {
  buildSandboxInstallingRecordUpdates,
  resolvePendingSandboxPersistenceFlag,
} from "./_lib/bootstrap";
export type { CliSandboxRecord } from "./_lib/types";

export function createSandboxPostHandler(
  overrides: Partial<SandboxPostDeps> = {}
) {
  const deps: SandboxPostDeps = {
    ...defaultSandboxPostDeps,
    ...overrides,
  };

  return async function POST(request: Request): Promise<Response> {
    // Sandbox CREATE provisions a VM, so gate on `tools.bash`. Solo callers
    // pass no team header and resolve to ALL_CAPABILITIES (no change). Team
    // callers with viewer role hit the denial before any external call.
    const teamId = readActiveTeamIdHeader(request);
    let creds: Awaited<ReturnType<typeof deps.getSandboxServiceCredentials>>;
    try {
      creds = await deps.getSandboxServiceCredentials(request, {
        allowInternal: true,
        teamId,
        requireCapability: "tools.bash",
      });
    } catch (error) {
      if (isSandboxCapabilityDeniedError(error)) {
        return NextResponse.json(
          { error: error.message },
          { status: error.status }
        );
      }
      throw error;
    }
    if (!creds)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const prepared = await prepareSandboxLaunch({
      deps,
      request,
      creds,
      productTeamId: teamId,
      toWorkspaceFn: toWorkspace,
    });
    if ("response" in prepared) return prepared.response;

    const existingResponse = await maybeReturnExistingSandboxResponse(
      deps,
      prepared.launch,
      request
    );
    if (existingResponse) return existingResponse;

    const limitDecision = await claimSandboxBootLimitOrResponse(
      deps,
      prepared.launch
    );
    if ("response" in limitDecision) return limitDecision.response;

    const collisionResponse = await maybeReturnNameCollisionResponse(
      deps,
      prepared.launch,
      limitDecision.limitClaimId,
      request
    );
    if (collisionResponse) return collisionResponse;

    const pendingRecord = await insertPendingSandboxLaunchRecord({
      deps,
      launch: prepared.launch,
      limitClaimId: limitDecision.limitClaimId,
      request,
    });
    if ("response" in pendingRecord) return pendingRecord.response;

    return buildSandboxLaunchStreamResponse({
      deps,
      launch: prepared.launch,
      record: pendingRecord.record,
    });
  };
}

export const POST = createSandboxPostHandler();

export function createSandboxGetHandler(
  overrides: Partial<SandboxGetDeps> = {}
) {
  const deps: SandboxGetDeps = {
    ...defaultSandboxGetDeps,
    ...overrides,
  };

  return async function GET(request: Request) {
    const activeTeamId = readActiveTeamIdHeader(request);
    const baseCreds = await deps.getSandboxServiceCredentials(request, {
      allowInternal: true,
    });
    if (!baseCreds)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const productTeam = await resolveSandboxListProductTeamId({
      deps,
      userId: baseCreds.userId,
      activeTeamId,
    });
    if ("response" in productTeam) return productTeam.response;

    const creds = productTeam.productTeamId
      ? {
          ...baseCreds,
          productTeamId: productTeam.productTeamId,
          allowPlatformSandbox: (
            await deps
              .loadUserPlatformAccess(
                baseCreds.userId,
                productTeam.productTeamId
              )
              .catch(() => ({ allowPlatformSandbox: false }))
          ).allowPlatformSandbox,
        }
      : baseCreds;

    const format = readSandboxFormat(request);
    const sandboxes = await deps.listSandboxesForUser(
      creds.userId,
      productTeam.productTeamId
    );
    if (sandboxes.length === 0) {
      return format === "cli"
        ? NextResponse.json([] as CliSandboxRecord[])
        : NextResponse.json({ sandboxes: [] });
    }

    await reconcileStaleListedSandboxes({ deps, creds, sandboxes });

    if (format === "cli") {
      const visible = sandboxes.filter((s) =>
        CLI_VISIBLE_STATUSES.has(s.status)
      );
      return NextResponse.json(visible.map(toCliSandboxRecord));
    }

    return NextResponse.json({
      sandboxes: sandboxes.map((sandbox) =>
        toSandboxClientRecord({
          ...sandbox,
          effective_timeout_ms:
            resolveEffectiveTimeoutFromActiveRecord(sandbox),
        })
      ),
    });
  };
}

export const GET = createSandboxGetHandler();
