# Sandbox CRUD Lifecycle Hardening Spec

Status: Proposed
Created: 2026-05-15
Scope: Sandbox create, read/detail, pause, resume, restart, stop, delete, exec, health, and client launch state.

## Purpose

This spec captures two independent review passes over the Mogplex sandbox CRUD/lifecycle control plane. It is designed for multi-session implementation. Do not try to land every item in one PR.

The common failure pattern is identity drift: DB rows, Vercel sandbox names, client launch state, and user-visible lifecycle events do not always use the same scoping or compare-and-set boundaries. The result can be wrong sandbox reuse, ready events for stale operations, hidden resume affordances, orphaned persistent resources, and limit bypasses.

## Current Context

PR #487 addresses one observed name-collision failure by retrying the Vercel name-collision probe with `resume:true` after a non-resume 404. That is useful, but it does not solve the broader root-directory identity issue below.

There is no `specs/` directory in this repo today. This document lives in `docs/` to preserve the handoff without touching the existing untracked `sandbox-lifecycle-refactor.md` file.

## Core Invariants

1. A sandbox identity must include every dimension that can produce a different working tree: user, repo, working branch, and root directory.
2. The same identity dimensions must be used by DB active lookup, Vercel sandbox name, collision matching, adoption, and client launch state.
3. Lifecycle mutations that depend on prior state must be compare-and-set checked. If the update returns no row, the operation lost the race and must stop emitting success.
4. User-visible `ready` events must be derived from persisted state, not a locally imagined snapshot.
5. A paused persistent sandbox is a valid resumable state even when the Vercel VM is stopped and even when no explicit `snapshot_id` is present.
6. Destructive actions must either verify remote teardown or preserve a row that can be retried/reaped.
7. Resume/restart are boot paths and must respect active sandbox admission limits.
8. Exec locks must only be acquired after ownership and sandbox existence are verified.

## Findings

### P0: Root Directory Missing From Sandbox Identity

Problem:

- `buildSandboxName()` is based on user, repo, and branch, but not root directory.
- Collision record matching also ignores root directory.
- Client launch keys in `hooks/use-sandbox.ts` are repo/branch scoped and ignore root directory.

Failing scenario:

1. Launch repo `R`, branch `main`, root `apps/web`.
2. Launch the same repo and branch with root `apps/admin`.
3. DB active lookup can distinguish these rows, but Vercel name/collision and client launch state can still bind the second launch to the first sandbox.

Likely files:

- `lib/sandbox/sandbox-name.ts`
- `lib/sandbox/launch.ts`
- `app/api/sandbox/route.ts`
- `hooks/use-sandbox.ts`
- `tests/unit/sandbox-name.test.ts`
- `tests/unit/sandbox-route.test.ts`

Fix direction:

- Add a stable root-directory segment to deterministic sandbox names. Use a normalized slug or short hash so names remain within Vercel limits.
- Include `rootDirectory` in `ResolveNameCollisionInput`.
- Match existing records by `root_directory` during collision resolution.
- Insert adopted records with the same root directory used for the launch.
- Include root directory in client launch keys and `getSandboxForRepo` selection.
- Add same repo/branch/different root tests for backend collision and client state.

Acceptance criteria:

- Two active sandboxes for the same repo and branch but different roots never share a Vercel name or client launch key.
- Collision resolution cannot return/adopt a sandbox for a different root directory.
- Existing rootless launches keep a stable name segment, for example `root`.

Migration note:

- Existing live sandboxes created before root-directory naming used names without the final root segment. After this lands, new launches probe names with `-root` or the selected workspace root, so old live Vercel sandboxes may not be resumed by name. Accept the one-time recreation/adoption impact unless operators choose to backfill or recycle old remote sandboxes before deploy.

## P0: Resume/Restart Emit Ready After Lost CAS Updates

Problem:

- Resume and persistent restart call `updateSandboxRecord()` for lifecycle transitions but ignore `null` returns.
- They can continue bootstrapping and emit `ready` even when the DB rejected the transition because another operation won the race.
- Some late writes, such as `preview_url` and error writes, omit `expectedSandboxId` and `fromStatuses`.

Failing scenario:

1. User double-clicks Resume, or clicks Resume then Stop.
2. One request moves the row; the stale request continues bootstrapping.
3. The stale request emits `ready` or overwrites a manual stop with an error.

Likely files:

- `app/api/sandbox/[id]/resume/route.ts`
- `app/api/sandbox/[id]/restart/route.ts`
- `tests/unit/sandbox-resume-route.test.ts`
- `tests/unit/sandbox-restart-route.test.ts`

Fix direction:

- Treat `updateSandboxRecord()` returning `null` as a cancellation/conflict.
- Abort the stream with a conflict/cancelled event when paused-to-installing or running updates fail.
- Only emit `ready` from the row returned by the successful persisted update.
- Guard preview and error writes with `expectedSandboxId` and status constraints.
- Consider a lifecycle operation token if status-only CAS is not enough.

Acceptance criteria:

- A failed paused-to-installing CAS does not run bootstrap.
- A failed installing-to-running CAS does not emit `ready`.
- A stop/delete that wins the race cannot be overwritten by a late resume/restart error write.

## P1: Paused Detail GET Can Look Stopped

Problem:

- Detail GET maps non-running Vercel SDK status to stopped.
- A persistent paused sandbox is expected to have a stopped VM, so this can make a resumable DB row look stopped in the response/UI.

Failing scenario:

1. User pauses a persistent sandbox.
2. Detail GET probes Vercel with `resume:false`.
3. The SDK reports a stopped VM.
4. Response says stopped or hides resume affordances even though the DB row is paused.

Likely files:

- `app/api/sandbox/[id]/route.ts`
- `lib/sandbox/ui-state.ts`
- `tests/unit/sandbox-detail-route.test.ts`
- `lib/sandbox/ui-state.test.ts`

Fix direction:

- Treat `record.status === "paused"` as a saved persistent state in detail reconciliation.
- Do not infer stopped from the SDK VM status for paused rows.
- Return the persisted paused row unless a stronger invariant proves it is invalid.

Acceptance criteria:

- Detail GET for a paused persistent row returns paused semantics.
- Resume affordance remains available after refresh/detail reconciliation.

## P1: Paused Without Snapshot Can Become Unresumable In UI

Problem:

- Pause writes `snapshot_id` from `sandbox.currentSnapshotId ?? null`.
- Persistent resume uses `Sandbox.get({ resume: true })` and does not require `snapshot_id`.
- UI state currently treats paused-without-snapshot as errored.

Failing scenario:

1. Persistent pause succeeds but `currentSnapshotId` is null or unavailable.
2. DB row is `paused`.
3. UI resolver maps it to errored rather than paused.
4. User loses Resume even though API resume can work.

Likely files:

- `app/api/sandbox/[id]/pause/route.ts`
- `lib/sandbox/ui-state.ts`
- `lib/sandbox/ui-state.test.ts`

Fix direction:

- For persistent rows, paused state should not require `snapshot_id`.
- Keep `snapshot_id` as telemetry/display when available, not as the resume gate for persistent sandboxes.
- Preserve stricter handling for legacy non-persistent snapshot restore paths if still needed.

Acceptance criteria:

- Persistent paused row with null `snapshot_id` resolves to `paused`.
- Non-persistent paused behavior remains explicit and tested.

## P1: Delete Can Leak Persistent Vercel Resources

Problem:

- DELETE currently stops the remote sandbox and then deletes the DB row when credentials resolve.
- Stop route uses `sandbox.delete()` for the destroy semantic.
- For persistent sandboxes, `stop()` can leave snapshots/name/resources behind with no DB row.

Failing scenario:

1. User deletes a persistent sandbox record.
2. Remote `stop()` succeeds and may auto-snapshot.
3. DB row is deleted.
4. Remote resources remain under the deterministic name with no row to manage them.

Likely files:

- `app/api/sandbox/[id]/route.ts`
- `app/api/sandbox/[id]/stop/route.ts`
- `tests/unit/sandbox-delete-route.test.ts`

Fix direction:

- For DELETE, call `sandbox.delete()` first.
- Fall back to `stop()` only if delete is unavailable, and be conservative about deleting the DB row.
- If teardown cannot be verified, keep or mark the row for reaper cleanup rather than deleting it.

Acceptance criteria:

- DELETE removes persistent Vercel sandbox resources when credentials resolve.
- If remote deletion cannot be confirmed, the DB row is not silently removed.

## P1: Resume Bypasses Active Sandbox Admission Limits

Problem:

- Create enforces sandbox boot/active limits.
- Resume wakes paused VMs and transitions them to active states without the same admission gate.
- SQL active counts exclude paused rows.

Failing scenario:

1. User has three running sandboxes and one paused sandbox.
2. User resumes the paused sandbox.
3. Active VM count can exceed the configured limit.

Likely files:

- `app/api/sandbox/[id]/resume/route.ts`
- `app/api/sandbox/[id]/restart/route.ts`
- `app/api/sandbox/route.ts`
- `lib/request-limits.ts`
- request-limit migration tests or route tests

Fix direction:

- Add an active admission check to resume before `Sandbox.get(..., resume:true)`.
- Consider whether persistent restart needs the same check when waking a stopped VM.
- Release any provisional claim on no-op/conflict/bootstrap failure.

Acceptance criteria:

- Resume is denied when active sandbox limits would be exceeded.
- Denial happens before waking the Vercel VM.
- Claims are not leaked on resume conflicts/failures.

## P2: Exec Lock Acquired Before Ownership Validation

Problem:

- `POST /api/sandbox/[id]/exec` acquires `exec_lock_token` by row id before loading/validating the owned sandbox record.
- The lock query is not user-scoped.

Failing scenario:

1. Authenticated user calls exec against another user's sandbox id.
2. The request mutates the target row's exec lock before ownership validation rejects it.
3. Normal failures release the lock, but aborted requests can leave a stale lock until timeout.

Likely files:

- `app/api/sandbox/[id]/exec/route.ts`
- `lib/request-limits.ts`
- `tests/unit/sandbox-exec-route.test.ts`

Fix direction:

- Load and authorize the sandbox record before acquiring the exec lock.
- Or make the lock acquisition user-scoped, but route-level validation first is simpler.
- Preserve existing rate-limit behavior after validation.

Acceptance criteria:

- Unauthorized/missing sandbox exec requests never mutate `exec_lock_token`.
- Concurrency behavior remains unchanged for authorized requests.

## Slice Plan

### Slice 1: Sandbox Identity

Goal: make sandbox identity root-directory scoped across backend and client.

Write scope:

- `lib/sandbox/sandbox-name.ts`
- `lib/sandbox/launch.ts`
- `app/api/sandbox/route.ts`
- `hooks/use-sandbox.ts`
- backend/client tests for same repo/branch/different roots

Validation:

```txt
pnpm exec vitest run lib/sandbox/launch.test.ts
pnpm exec tsx --test tests/unit/sandbox-route.test.ts
pnpm typecheck
```

### Slice 2: Resume/Restart CAS Safety

Goal: stale lifecycle operations cannot emit ready or overwrite newer states.

Write scope:

- `app/api/sandbox/[id]/resume/route.ts`
- `app/api/sandbox/[id]/restart/route.ts`
- `tests/unit/sandbox-resume-route.test.ts`
- `tests/unit/sandbox-restart-route.test.ts`

Validation:

```txt
pnpm exec tsx --test tests/unit/sandbox-resume-route.test.ts
pnpm exec tsx --test tests/unit/sandbox-restart-route.test.ts
pnpm typecheck
```

### Slice 3: Paused State Semantics

Goal: persistent paused sandboxes remain resumable in detail responses and UI even without `snapshot_id`.

Write scope:

- `app/api/sandbox/[id]/route.ts`
- `lib/sandbox/ui-state.ts`
- `tests/unit/sandbox-detail-route.test.ts`
- `lib/sandbox/ui-state.test.ts`

Validation:

```txt
pnpm exec tsx --test tests/unit/sandbox-detail-route.test.ts
pnpm exec vitest run lib/sandbox/ui-state.test.ts
pnpm typecheck
```

### Slice 4: Delete Semantics

Goal: DELETE either removes remote persistent resources or keeps a row for cleanup.

Write scope:

- `app/api/sandbox/[id]/route.ts`
- `tests/unit/sandbox-delete-route.test.ts`
- possibly `lib/sandbox/reaper.ts` if a cleanup marker is added

Validation:

```txt
pnpm exec tsx --test tests/unit/sandbox-delete-route.test.ts
pnpm typecheck
```

### Slice 5: Resume Admission Limits

Goal: resume/restart cannot exceed active sandbox limits.

Write scope:

- `app/api/sandbox/[id]/resume/route.ts`
- `app/api/sandbox/[id]/restart/route.ts` if needed
- `lib/request-limits.ts` only if a new helper is needed
- request-limit and route tests

Validation:

```txt
pnpm exec tsx --test tests/unit/sandbox-resume-route.test.ts
pnpm exec tsx --test tests/unit/request-limits.test.ts
pnpm typecheck
```

### Slice 6: Exec Lock Ownership

Goal: exec lock mutation happens only after ownership validation.

Write scope:

- `app/api/sandbox/[id]/exec/route.ts`
- `tests/unit/sandbox-exec-route.test.ts`

Validation:

```txt
pnpm exec tsx --test tests/unit/sandbox-exec-route.test.ts
pnpm typecheck
```

## Multi-Session Handoff Checklist

At the start of each future session:

1. Check the current branch and PR state.
2. Pull latest `main` before starting a new slice.
3. Re-read this spec and the files in the slice write scope.
4. Confirm whether PR #487 or later sandbox lifecycle PRs have already changed the target area.
5. Keep each slice as a focused PR. Do not combine identity, CAS, delete, limits, and exec-lock changes unless explicitly requested.
6. Preserve unrelated untracked files such as `artifacts/live-sandbox-chip.png` and `sandbox-lifecycle-refactor.md`.

## Non-Goals

- No broad UI redesign.
- No change to Vercel Sandbox SDK version unless a slice proves it is required.
- No removal of legacy non-persistent restart paths unless a separate migration plan covers it.
- No changes to unrelated automation/job-run lifecycle behavior.
