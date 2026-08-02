export function readSandboxPersistentFlag(sandbox: unknown): boolean | null {
  if (!sandbox || typeof sandbox !== "object") return null;

  const direct = (sandbox as { persistent?: unknown }).persistent;
  if (typeof direct === "boolean") return direct;

  const nested = (sandbox as { sandbox?: { persistent?: unknown } }).sandbox
    ?.persistent;
  return typeof nested === "boolean" ? nested : null;
}

export function isSandboxExplicitlyNonPersistent(sandbox: unknown): boolean {
  return readSandboxPersistentFlag(sandbox) === false;
}
