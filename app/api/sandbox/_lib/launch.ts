import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveEffectiveSandboxTimeoutMs } from "@/lib/repo-settings";
import {
  resolveBillingLinkedProjectOwner,
  resolveBillingLinkedProjectSelection,
} from "@/lib/vercel/target-resolution";
import { buildLimitResponse, releaseLimitClaim } from "@/lib/request-limits";
import { buildSandboxName } from "@/lib/sandbox/sandbox-name";
import { toSandboxClientRecord } from "@/lib/sandbox/summary";
import { SANDBOX_STREAM_SELECT } from "./constants";
import { resolveLaunchRootDirectory } from "./utils";
import {
  resolveSandboxCreateContextOrResponse,
  loadSandboxLaunchRepoAccess,
  resolveSandboxLaunchRequestOrResponse,
  resolveSandboxLaunchRepoIdOrResponse,
} from "./validation";
import { resolveSandboxLaunchRuntimePreparation } from "./provisioning";
import { resolvePendingSandboxPersistenceFlag } from "./bootstrap";
import type { SandboxServiceCredentials } from "@/lib/sandbox/get-user-credentials";
import type { SandboxRecordRow } from "@/lib/types";
import type {
  SandboxLaunchPreparation,
  SandboxLaunchPreparationResult,
  SandboxBootLimitClaimResolution,
  PendingSandboxLaunchRecordResult,
  SandboxLaunchRequestInput,
  toWorkspace,
} from "./types";
import type { SandboxPostDeps } from "./deps";

export { buildSandboxLaunchStreamResponse } from "./stream";

export function releaseSandboxBootLimitClaim(
  userId: string,
  claimId: string | null
) {
  if (!claimId) return Promise.resolve();
  return releaseLimitClaim({
    userId,
    routeKey: "sandbox_boot",
    claimId,
  });
}

export async function prepareSandboxLaunch(input: {
  deps: SandboxPostDeps;
  request: Request;
  creds: SandboxServiceCredentials;
  productTeamId: string | null;
  toWorkspaceFn: typeof toWorkspace;
}): Promise<SandboxLaunchPreparationResult> {
  const requestBody = (await input.request.json()) as SandboxLaunchRequestInput;
  const repoId = resolveSandboxLaunchRepoIdOrResponse(requestBody);
  if ("response" in repoId) return repoId;

  const repoAccess = await loadSandboxLaunchRepoAccess({
    deps: input.deps,
    creds: input.creds,
    repoId: repoId.repoId,
    productTeamId: input.productTeamId,
  });
  if ("response" in repoAccess) return repoAccess;

  const launchRequest = resolveSandboxLaunchRequestOrResponse({
    requestBody,
    repoDefaultBranch: repoAccess.repo.default_branch,
  });
  if ("response" in launchRequest) return launchRequest;

  const workspace = input.toWorkspaceFn(repoAccess.repo.workspace);
  const effectiveSandboxTimeoutMs = resolveEffectiveSandboxTimeoutMs({
    repoTimeoutMs: repoAccess.repo.sandbox_timeout_ms,
    workspaceTimeoutMs: workspace?.sandbox_timeout_ms,
  });
  const linkedProjectOwner = resolveBillingLinkedProjectOwner({
    workspaceBillingModeInput: workspace?.sandbox_billing_mode,
    repoBillingModeOverrideInput: repoAccess.repo.sandbox_billing_mode_override,
    repoLinkedProjectId: repoAccess.repo.vercel_project_id,
    workspaceLinkedProjectId: workspace?.sandbox_vercel_project_id,
    accountLinkedProjectId: input.creds.accountDefaultVercelProjectId,
  });
  const linkedProject = resolveBillingLinkedProjectSelection({
    workspaceBillingModeInput: workspace?.sandbox_billing_mode,
    repoBillingModeOverrideInput: repoAccess.repo.sandbox_billing_mode_override,
    repoLinkedProjectId: repoAccess.repo.vercel_project_id,
    repoLinkedTeamId: repoAccess.repo.vercel_team_id,
    workspaceLinkedProjectId: workspace?.sandbox_vercel_project_id,
    workspaceLinkedTeamId: workspace?.sandbox_vercel_team_id,
    accountLinkedProjectId: input.creds.accountDefaultVercelProjectId,
    accountLinkedTeamId: input.creds.accountDefaultVercelTeamId,
  });
  const createContextResult = await resolveSandboxCreateContextOrResponse({
    deps: input.deps,
    creds: input.creds,
    repo: repoAccess.repo,
    workspace,
    linkedProjectOwner,
    linkedProject,
    toWorkspaceFn: input.toWorkspaceFn,
  });
  if ("response" in createContextResult) {
    return createContextResult;
  }

  // Compute the launch-time path once and pass it to every downstream
  // step. Both the runtime detector and the SandboxLaunchPreparation
  // object need it, and computing twice would risk a future divergence
  // if either call site's logic ever changes shape.
  const effectiveRootDirectory = resolveLaunchRootDirectory({
    request: launchRequest.launchRequest,
    repo: repoAccess.repo,
  });

  const runtimePreparation = await resolveSandboxLaunchRuntimePreparation({
    repo: repoAccess.repo,
    githubToken: repoAccess.githubToken,
    launchRequest: launchRequest.launchRequest,
    userId: input.creds.userId,
    productTeamId: input.productTeamId,
    effectiveRootDirectory,
  });

  return {
    launch: {
      creds: input.creds,
      productTeamId: input.productTeamId,
      actorUserId: input.creds.userId,
      repo: repoAccess.repo,
      githubToken: repoAccess.githubToken,
      launchRequest: launchRequest.launchRequest,
      repoId: launchRequest.launchRequest.repoId,
      effectiveRootDirectory,
      linkedProjectOwner,
      linkedProject,
      createContext: createContextResult.createContext,
      effectiveSandboxTimeoutMs,
      ...runtimePreparation,
    } satisfies SandboxLaunchPreparation,
  };
}

export async function maybeReturnExistingSandboxResponse(
  deps: SandboxPostDeps,
  launch: SandboxLaunchPreparation
) {
  const existing = await deps.getActiveSandboxForRepo(
    launch.repoId,
    launch.creds.userId,
    launch.launchRequest.workingBranch,
    launch.effectiveRootDirectory,
    launch.productTeamId
  );
  if (!existing) return null;

  const existingState = await deps.resolveActiveSandboxState({
    sandboxCredentials: launch.creds,
    record: existing,
  });

  if (existingState.kind === "unresolvable") {
    console.warn(
      `[sandbox/launch] Retiring unresolvable active record ${existing.id} (${existing.sandbox_id}) to unblock launch`
    );
    // Displacement is the consequence of an explicit user launch, so
    // "manual" reads more honestly in the UI than "unknown".
    const retired = await deps.stopSandboxRecord(existing.id, {
      expectedSandboxId: existing.sandbox_id,
      stopReason: "manual",
    });
    if (!retired) {
      // Retry without expectedSandboxId: a concurrent write may have
      // changed sandbox_id between the read above and this update, so
      // relax the guard rather than abandon the retirement.
      await deps.stopSandboxRecord(existing.id, { stopReason: "manual" });
    }
  }

  if (existingState.kind === "running" || existingState.kind === "pending") {
    return NextResponse.json({ sandbox: toSandboxClientRecord(existing) });
  }

  if (existingState.kind === "stopped") {
    await deps.stopSandboxRecord(existing.id, {
      expectedSandboxId: existing.sandbox_id,
      stopReason: "vm_gone",
    });
    return null;
  }

  if (existingState.kind === "stale_pending") {
    await deps.stopSandboxRecord(existing.id, {
      expectedSandboxId: existing.sandbox_id,
      fromStatuses: ["creating", "installing"],
      stopReason: "stuck_boot",
    });
    return null;
  }

  if (existing.sandbox_id && existing.sandbox_id !== "pending") {
    // Last-resort retirement: at this point the VM was neither usable nor
    // classified as a stale boot/missing VM, so preserve that uncertainty.
    await deps.stopSandboxRecord(existing.id, {
      expectedSandboxId: existing.sandbox_id,
      stopReason: "unknown",
    });
  }

  return null;
}

// Runs only when maybeReturnExistingSandboxResponse returned null (no usable
// active DB record). If the DB had a record we already short-circuited; this
// guard exists to recover orphaned Vercel sandboxes that have no DB row, or
// records that fall outside the active-status filter (e.g. paused/stopped
// rows whose Vercel sandbox is still live under the same deterministic name).
//
// The boot-limit claim is taken before this runs so the claim id can be
// attached to a freshly adopted record (so adoption participates in active
// counts) and so the claim can be released cleanly when we end up resuming
// an existing record without booting anything new.
export async function maybeReturnNameCollisionResponse(
  deps: SandboxPostDeps,
  launch: SandboxLaunchPreparation,
  limitClaimId: string | null
) {
  const sandboxName = buildSandboxName({
    repoId: launch.repoId,
    workingBranch: launch.launchRequest.workingBranch,
    userId: launch.creds.userId,
    productTeamId: launch.productTeamId,
    rootDirectory: launch.effectiveRootDirectory,
  });
  const collision = await deps.resolveNameCollision({
    name: sandboxName,
    repoId: launch.repoId,
    userId: launch.creds.userId,
    productTeamId: launch.productTeamId,
    actorUserId: launch.actorUserId,
    workingBranch: launch.launchRequest.workingBranch,
    baseBranch: launch.launchRequest.baseBranch,
    rootDirectory: launch.effectiveRootDirectory,
    runtime: launch.runtime,
    credentials: launch.createContext.credentials,
    billingSource: launch.createContext.ownership.billingSource,
    billingTeamId: launch.createContext.credentials.vercelTeamId,
    billingProjectId: launch.createContext.credentials.vercelProjectId,
    limitClaimId,
  });

  if (collision.kind === "create") return null;

  // Both resume and adopt short-circuit without booting a new sandbox, so
  // the freshly minted claim has no boot to amortize. Resume reuses an
  // existing active record; adopt just inserted a row with status='running'
  // (which already counts in v_active_sandboxes via the SQL claim helper).
  // In both cases the in-flight limit_events row should be released so it
  // does not linger in v_provisional_boots until the TTL expires.
  await releaseSandboxBootLimitClaim(launch.creds.userId, limitClaimId);

  return NextResponse.json({ sandbox: collision.record });
}

export async function claimSandboxBootLimitOrResponse(
  deps: SandboxPostDeps,
  launch: SandboxLaunchPreparation
): Promise<SandboxBootLimitClaimResolution> {
  const limitDecision = await deps.enforceSandboxBootLimits({
    userId: launch.creds.userId,
    repoId: launch.repoId,
  });
  if (!limitDecision.allowed) {
    return { response: buildLimitResponse(limitDecision) };
  }
  return { limitClaimId: limitDecision.claimId ?? null };
}

export async function insertPendingSandboxLaunchRecord(input: {
  deps: SandboxPostDeps;
  launch: SandboxLaunchPreparation;
  limitClaimId: string | null;
}): Promise<PendingSandboxLaunchRecordResult> {
  const bootStartedAt = new Date().toISOString();
  const { data: record, error: insertErr } = await supabaseAdmin
    .from("sandboxes")
    .insert({
      user_id: input.launch.creds.userId,
      product_team_id: input.launch.productTeamId,
      actor_user_id: input.launch.actorUserId,
      repo_id: input.launch.repoId,
      sandbox_id: "pending",
      base_branch: input.launch.launchRequest.baseBranch,
      working_branch: input.launch.launchRequest.workingBranch,
      limit_claim_id: input.limitClaimId,
      status: "creating",
      runtime: input.launch.runtime,
      billing_source: input.launch.createContext.ownership.billingSource,
      billing_team_id: input.launch.createContext.credentials.vercelTeamId,
      billing_project_id:
        input.launch.createContext.credentials.vercelProjectId,
      vercel_team_id: input.launch.createContext.credentials.vercelTeamId,
      vercel_project_id: input.launch.createContext.credentials.vercelProjectId,
      sandbox_billing_target: input.launch.createContext.credentials
        .vercelTeamId
        ? "team"
        : "personal",
      health_status: "starting",
      boot_attempts: 1,
      last_boot_started_at: bootStartedAt,
      last_boot_completed_at: null,
      last_boot_error: null,
      last_preview_http_status: null,
      last_preview_error: null,
      install_log: "",
      dev_log: "",
      persistent: resolvePendingSandboxPersistenceFlag(),
      // effectiveRootDirectory is already string | null; use it for both
      // columns so terminal_cwd and root_directory cannot drift if the
      // upstream resolver ever changes shape (e.g. starts producing
      // empty strings, which `|| null` would silently coerce).
      terminal_cwd: input.launch.effectiveRootDirectory,
      root_directory: input.launch.effectiveRootDirectory,
    })
    .select(SANDBOX_STREAM_SELECT)
    .single();

  if (!insertErr && record) {
    return {
      record: record as SandboxRecordRow,
      limitClaimId: input.limitClaimId,
    };
  }

  if (insertErr?.code === "23505") {
    const concurrent = await input.deps.getActiveSandboxForRepo(
      input.launch.repoId,
      input.launch.creds.userId,
      input.launch.launchRequest.workingBranch,
      input.launch.effectiveRootDirectory,
      input.launch.productTeamId
    );
    if (concurrent) {
      await releaseSandboxBootLimitClaim(
        input.launch.creds.userId,
        input.limitClaimId
      );
      return {
        response: NextResponse.json({
          sandbox: toSandboxClientRecord(concurrent),
        }),
      };
    }
  }

  await releaseSandboxBootLimitClaim(
    input.launch.creds.userId,
    input.limitClaimId
  );
  return {
    response: NextResponse.json(
      { error: insertErr?.message || "Failed to create record" },
      { status: 500 }
    ),
  };
}

export { resolvePendingSandboxPersistenceFlag } from "./bootstrap";
