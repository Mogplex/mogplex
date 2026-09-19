import type { DecisionScope } from "./types";

/**
 * How long one process trusts a loaded setting. Short on purpose: after an
 * admin turns checks off, nothing may be sent for longer than this.
 */
export const DECISION_CHECKS_CACHE_TTL_MS = 30_000;

/** An enforced check waits in front of a shell command, so bound the read. */
export const DECISION_CHECKS_LOOKUP_TIMEOUT_MS = 2_000;

/** The row that holds the choice: the team, or the person outside a team. */
export type DecisionChecksOwner = {
  table: "teams" | "profiles";
  id: string;
};

export type DecisionChecksLoader = (
  owner: DecisionChecksOwner
) => Promise<boolean>;

/** Resolves to whether the account allows checks. Must never reject. */
export type DecisionChecksGate = (scope: DecisionScope) => Promise<boolean>;

/** Work inside a team follows the team's choice, never a member's own. */
export function decisionChecksOwner(
  scope: Pick<DecisionScope, "teamId" | "userId">
): DecisionChecksOwner | null {
  if (scope.teamId) return { table: "teams", id: scope.teamId };
  if (scope.userId) return { table: "profiles", id: scope.userId };
  return null;
}

/** A missing row has no one who chose "off", so it reads as the default. */
const loadFromDatabase: DecisionChecksLoader = async (owner) => {
  // Lazy for the same reason as the event recorder: most importers of this
  // module never reach the database client.
  const store = await import("./account-setting-store");
  return (await store.readDecisionChecksSetting(owner)) !== false;
};

async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`timed out after ${timeoutMs} ms`)),
      timeoutMs
    );
  });
  try {
    return await Promise.race([work, expired]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build the gate `decide` and `classify` consult before anything leaves the
 * process. A failed lookup reads as "off": skipping a check costs what an
 * evaluator outage already costs, while sending an opted-out account's data
 * cannot be taken back. Failures are not cached, so the next call retries.
 */
export function createDecisionChecksGate(
  load: DecisionChecksLoader = loadFromDatabase,
  now: () => number = Date.now
): DecisionChecksGate & { forget: (owner: DecisionChecksOwner) => void } {
  const cache = new Map<string, { enabled: boolean; expiresAt: number }>();
  const pending = new Map<string, Promise<boolean>>();
  // Bumped by `forget`, so a read that began before a change cannot write
  // the value it saw back into the cache after the change.
  const generations = new Map<string, number>();
  const keyOf = (owner: DecisionChecksOwner) => `${owner.table}:${owner.id}`;

  const gate = async (scope: DecisionScope): Promise<boolean> => {
    const owner = decisionChecksOwner(scope);
    // Ownerless tool instances have no account whose choice could apply.
    if (!owner) return true;
    const key = keyOf(owner);
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now()) return cached.enabled;
    // Checks on one turn start together; they share a single read.
    const running = pending.get(key);
    if (running) return running;
    const generation = generations.get(key) ?? 0;
    const isCurrent = () => (generations.get(key) ?? 0) === generation;
    const lookup = withTimeout(load(owner), DECISION_CHECKS_LOOKUP_TIMEOUT_MS)
      .then((enabled) => {
        if (isCurrent()) {
          cache.set(key, {
            enabled,
            expiresAt: now() + DECISION_CHECKS_CACHE_TTL_MS,
          });
        }
        return enabled;
      })
      .catch((error: unknown) => {
        if (isCurrent()) cache.delete(key);
        console.warn("[decisions] could not read the account setting", {
          owner: key,
          error,
        });
        return false;
      })
      .finally(() => {
        if (pending.get(key) === lookup) pending.delete(key);
      });
    pending.set(key, lookup);
    return lookup;
  };
  return Object.assign(gate, {
    /** Drop a cached choice so a change applies at once in this process. */
    forget: (owner: DecisionChecksOwner) => {
      const key = keyOf(owner);
      generations.set(key, (generations.get(key) ?? 0) + 1);
      cache.delete(key);
      // Callers after the change start a fresh read, never join a stale one.
      pending.delete(key);
    },
  });
}

/** Process-wide gate used by the runtime. Tests build their own. */
export const decisionChecksEnabled = createDecisionChecksGate();
