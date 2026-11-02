import { CHECK_KINDS } from "./plan";
import type { RepositoryCheckResult } from "./runner";
import type { RepositoryCheckReceipt } from "./tool";

export type WorkspaceCheckRevision = { sandboxId: string; revision: string };

export function createRepositoryVerificationState() {
  let current: WorkspaceCheckRevision | null = null;
  let changed = false;
  let attempted = false;
  let blocked: string | null = null;
  let error: string | null = null;
  const results = new Map<
    RepositoryCheckResult["kind"],
    RepositoryCheckResult
  >();
  const manualKinds = new Set<RepositoryCheckResult["kind"]>();

  const same = (left: WorkspaceCheckRevision, right: WorkspaceCheckRevision) =>
    left.sandboxId === right.sandboxId && left.revision === right.revision;
  const observe = (revision: WorkspaceCheckRevision) => {
    if (blocked || (current && !same(current, revision))) {
      changed = true;
      attempted = false;
      blocked = null;
      error = null;
      results.clear();
      manualKinds.clear();
    }
    current = { ...revision };
  };
  const block = (reason: string) => {
    changed = true;
    attempted = false;
    blocked = reason;
    results.clear();
    manualKinds.clear();
  };

  return {
    observe,
    invalidate() {
      // An acknowledged file write invalidates proof without a tree scan.
      current = null;
      changed = true;
      attempted = false;
      blocked = null;
      error = null;
      results.clear();
      manualKinds.clear();
    },
    requireChecks() {
      changed = true;
    },
    block,
    recordManual(result: RepositoryCheckResult) {
      if (!current || blocked) return;
      if (result.status === "blocked") {
        block(result.reason ?? "Command completion could not be confirmed.");
        return;
      }
      results.set(result.kind, { ...result });
      manualKinds.add(result.kind);
      if (manualKinds.size === CHECK_KINDS.length) error = null;
    },
    recordReceipt(receipt: RepositoryCheckReceipt) {
      if (receipt.commandCompletion === "unknown") {
        block(receipt.error ?? "Command completion could not be confirmed.");
        return;
      }
      const {
        sandboxId,
        workspaceRevisionBefore: before,
        workspaceRevisionAfter: after,
      } = receipt;
      if (!sandboxId || !before || !after) {
        block(
          receipt.error ?? "Verification has no confirmed workspace revision."
        );
        return;
      }
      const start = { sandboxId, revision: before };
      if (current && !same(current, start)) return;
      observe(start);
      if (before !== after) {
        observe({ sandboxId, revision: after });
        error = receipt.error ?? "Source contents changed during verification.";
        return;
      }
      blocked = null;
      // This is an attempt/visibility gate, not a passing-check requirement.
      // Explicit scope limits and unavailable scripts can end a turn, while
      // only actual passes for all four commands can set verified below.
      attempted = true;
      results.clear();
      manualKinds.clear();
      for (const row of receipt.checks) results.set(row.kind, { ...row });
      error =
        receipt.error ??
        ((!receipt.ok || !receipt.verified) &&
        receipt.checks.every((row) => row.status === "passed")
          ? "Verification completion could not be confirmed."
          : null);
    },
    summary() {
      const checks = CHECK_KINDS.map(
        (kind): RepositoryCheckResult => ({
          ...(results.get(kind) ?? {
            kind,
            command: null,
            status: blocked ? "blocked" : "not_run",
            exitCode: null,
            reason:
              blocked ??
              "No result has been recorded for these source contents.",
          }),
        })
      );
      return {
        changed,
        required:
          changed &&
          !blocked &&
          !attempted &&
          results.size < CHECK_KINDS.length,
        verified:
          !blocked && !error && checks.every((row) => row.status === "passed"),
        error: blocked ?? error,
        checks,
      };
    },
  };
}
