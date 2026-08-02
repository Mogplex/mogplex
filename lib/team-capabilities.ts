import { isUuid } from "@/lib/uuid";

/**
 * Capability strings are dot-namespaced. Wildcards match any suffix at their
 * own dot boundary: `models.*` covers `models.openai`, `models.openai.gpt-5`,
 * etc. The literal `*` matches everything (owner/admin grant).
 */
export type Capability = string;

export const TEAM_RESOURCE_WRITE_CAPABILITY: Capability = "projects.write";

export type TeamRole = "owner" | "admin" | "developer" | "viewer";

/**
 * v1 role presets. Locked decision #4 (project_teams_rbac_sprint) — no
 * per-member overrides until post-v1. Owner is reserved for billing /
 * ownership transfer; admin has the same operational grant.
 */
export const ROLE_PRESETS: Record<TeamRole, readonly Capability[]> = {
  owner: ["*"],
  admin: ["*"],
  developer: [
    "models.*",
    "tools.bash",
    "tools.write_file",
    "tools.web_search",
    "tools.web_fetch",
    "tools.virtual_exec",
    "tools.github_api",
    "tools.memories",
    "connections.create",
    TEAM_RESOURCE_WRITE_CAPABILITY,
  ],
  viewer: [
    "models.*",
    "tools.web_search",
    "tools.web_fetch",
    "tools.virtual_exec",
  ],
};

export const ALL_CAPABILITIES: ReadonlySet<Capability> = new Set(["*"]);

/**
 * True when the granted capability set covers `required`. Matching rules:
 *   - `*` (literal) in caps matches anything.
 *   - A wildcard cap `foo.*` matches `foo`, `foo.bar`, `foo.bar.baz`.
 *   - Otherwise, exact string match.
 */
export function hasCapability(
  caps: ReadonlySet<Capability>,
  required: Capability
): boolean {
  if (caps.has("*")) return true;
  if (caps.has(required)) return true;
  // Walk parent namespaces: required = "tools.bash" → check "tools.*".
  // Also handle multi-segment required = "models.openai.gpt-5" → "models.openai.*", "models.*".
  const parts = required.split(".");
  for (let i = parts.length - 1; i > 0; i--) {
    const wildcard = `${parts.slice(0, i).join(".")}.*`;
    if (caps.has(wildcard)) return true;
  }
  return false;
}

export function presetForRole(role: TeamRole): ReadonlySet<Capability> {
  return new Set(ROLE_PRESETS[role]);
}

export type ResolveMemberCapabilitiesDeps = {
  lookupRole: (userId: string, teamId: string) => Promise<TeamRole | null>;
};

export type ActiveTeamCapabilityContext =
  | {
      ok: true;
      teamId: string | null;
      capabilities?: ReadonlySet<Capability>;
    }
  | {
      ok: false;
      status: 403 | 500;
      error: string;
    };

export type ResolveActiveTeamCapabilitiesDeps = {
  loadMemberRole: (
    userId: string,
    teamId: string
  ) => Promise<{
    data: { role: TeamRole } | null;
    error: { message: string } | null;
  }>;
  logError: (message: string, error: { message: string }) => void;
};

const defaultLookupRole: ResolveMemberCapabilitiesDeps["lookupRole"] = async (
  userId,
  teamId
) => {
  // Lazy import keeps lib/team-capabilities importable from environments
  // that don't have Supabase env vars (tests, CLI tools).
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const { data, error } = await supabaseAdmin
    .from("team_members")
    .select("role")
    .eq("team_id", teamId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  const role = data.role as TeamRole;
  if (
    role !== "owner" &&
    role !== "admin" &&
    role !== "developer" &&
    role !== "viewer"
  )
    return null;
  return role;
};

const defaultResolveActiveTeamCapabilitiesDeps: ResolveActiveTeamCapabilitiesDeps =
  {
    async loadMemberRole(userId, teamId) {
      const { supabaseAdmin } = await import("@/lib/supabase/admin");
      const { data, error } = await supabaseAdmin
        .from("team_members")
        .select("role")
        .eq("team_id", teamId)
        .eq("user_id", userId)
        .maybeSingle();
      return {
        data: data as { role: TeamRole } | null,
        error: error ? { message: error.message } : null,
      };
    },
    logError(message, error) {
      console.error(message, error);
    },
  };

export function createResolveMemberCapabilities(
  overrides: Partial<ResolveMemberCapabilitiesDeps> = {}
) {
  const deps: ResolveMemberCapabilitiesDeps = {
    lookupRole: overrides.lookupRole ?? defaultLookupRole,
  };
  /**
   * Solo scope (no teamId) → all capabilities (no regression for users who
   * never join a team). Team scope → preset for the user's role. Non-members
   * fail closed (empty set) so a stray teamId in a request can't elevate.
   */
  return async function resolveMemberCapabilities(
    userId: string,
    teamId: string | null | undefined
  ): Promise<ReadonlySet<Capability>> {
    if (!teamId) return ALL_CAPABILITIES;
    const role = await deps.lookupRole(userId, teamId);
    if (!role) return new Set();
    return presetForRole(role);
  };
}

export const resolveMemberCapabilities = createResolveMemberCapabilities();

export function createResolveActiveTeamCapabilities(
  overrides: Partial<ResolveActiveTeamCapabilitiesDeps> = {}
) {
  const deps: ResolveActiveTeamCapabilitiesDeps = {
    ...defaultResolveActiveTeamCapabilitiesDeps,
    ...overrides,
  };

  return async function resolveActiveTeamCapabilities(
    userId: string,
    teamId: string | null | undefined
  ): Promise<ActiveTeamCapabilityContext> {
    if (!teamId) return { ok: true, teamId: null };

    const { data, error } = await deps.loadMemberRole(userId, teamId);
    if (error) {
      deps.logError("Active team membership lookup failed", error);
      return { ok: false, status: 500, error: "Internal server error" };
    }
    if (!data) {
      return { ok: false, status: 403, error: "Forbidden" };
    }

    const role = data.role;
    if (
      role !== "owner" &&
      role !== "admin" &&
      role !== "developer" &&
      role !== "viewer"
    ) {
      return { ok: false, status: 403, error: "Forbidden" };
    }

    return {
      ok: true,
      teamId,
      capabilities: presetForRole(role),
    };
  };
}

export const resolveActiveTeamCapabilities =
  createResolveActiveTeamCapabilities();

/**
 * Capability-denied / allowlist errors raised by the model and tool gates.
 * Stable strings so call sites and UI surfaces can detect them.
 */
export const CAPABILITY_MODEL_DENIED_ERROR =
  "This model is not enabled for your team role.";
export const MODEL_NOT_IN_ALLOWLIST_ERROR =
  "This model is not on the team's model allowlist.";
/**
 * Distinct from MODEL_NOT_IN_ALLOWLIST_ERROR on purpose: "we could not check"
 * and "not permitted" are different situations for the user. The first is
 * transient and worth retrying; the second needs a team admin.
 */
export const MODEL_ALLOWLIST_UNAVAILABLE_ERROR =
  "Couldn't verify the team's model allowlist. Please try again.";

/**
 * Machine-readable tag for the error above, carried as `.code`. Telemetry and
 * retry classification must key off this, never off the message: the message is
 * end-user copy and someone will reword it, which should not silently
 * reclassify the failure. See `isDependencyUnavailableAutomationFailure`.
 */
export const MODEL_ALLOWLIST_UNAVAILABLE_CODE = "MODEL_ALLOWLIST_UNAVAILABLE";

/**
 * Retry-After for the 503 every HTTP surface returns on this error. 5s, not 1s:
 * the cost of a retry lands on the dependency, not the caller — each attempt is
 * two `teams` reads plus a jittered sleep inside loadTeamAllowlistState, so a
 * client honouring a 1s hint polls at 1Hz for the whole outage. That is the
 * load amplification the throttling here exists to avoid, and the throttle does
 * not help because it governs emission, not the read. 5s still recovers
 * promptly from a blip.
 */
export const ALLOWLIST_UNAVAILABLE_RETRY_AFTER_SECONDS = 5;

/** The error thrown when a team's allowlist could not be read. */
export function modelAllowlistUnavailableError() {
  return Object.assign(new Error(MODEL_ALLOWLIST_UNAVAILABLE_ERROR), {
    code: MODEL_ALLOWLIST_UNAVAILABLE_CODE,
  });
}

/**
 * True for the error above. HTTP surfaces need this because their catch-alls
 * map every model-resolution failure to a permanent status (400/403), which
 * tells a client not to retry — wrong for a failure whose own copy says
 * "Please try again." Matches the code, not the message, for the same reason
 * the automation classifier does.
 *
 * Walks the `cause` chain, matching `readErrorCode` on the automation side.
 * Without it the two detectors disagree on exactly the case that happens in
 * practice: lib/flows/server.ts re-throws this wrapped in a FlowServiceError,
 * which would then fall back to a permanent status.
 */
export function isModelAllowlistUnavailableError(error: unknown): boolean {
  // Bounded rather than `while (true)`: a self-referential or cyclic cause
  // chain must not hang a request thread.
  let current: unknown = error;
  for (let depth = 0; depth < 10; depth++) {
    if (typeof current !== "object" || current === null) return false;
    if (
      (current as { code?: unknown }).code === MODEL_ALLOWLIST_UNAVAILABLE_CODE
    ) {
      return true;
    }
    const next = (current as { cause?: unknown }).cause;
    if (next === undefined || next === current) return false;
    current = next;
  }
  return false;
}

/**
 * Module-private on purpose. `{ allowlist: null, ok: false }` reproduces the
 * exact footgun that `loadTeamModelAllowlist` was deleted for — a caller
 * reading `.allowlist` and forgetting `.ok` gets a fail-open. Exporting only
 * `loadTeamAllowlistState` leaves no spelling of this read that can fail open.
 */
type TeamModelAllowlistResult = {
  allowlist: readonly string[] | null;
  /** Underlying failure message; set only when `ok` is false. */
  reason?: string;
  /**
   * False only when the read itself failed. A null allowlist alone cannot carry
   * that: "this team has no allowlist" and "the read failed" are both absences,
   * and only one of them means unrestricted.
   */
  ok: boolean;
};

/**
 * The allowlist as known to a caller that must not guess. `unknown` exists so
 * an unreadable allowlist cannot be spelled the same way as an absent one —
 * every gate that consumes this has to handle the third case explicitly.
 *
 * Modelled as a closed union rather than `readonly string[] | null` plus a
 * boolean because the pair form has a representable-but-meaningless state
 * (models present, not ok) and lets a call site drop the flag silently.
 */
export type TeamAllowlistState =
  | { status: "unrestricted" }
  | { status: "restricted"; models: readonly string[] }
  // `reason` travels with the state so a denying call site can name the cause
  // itself. The console.error in the read is deduped per team, so on its own it
  // is a best-effort trace — a denial landing inside a suppression window would
  // otherwise have no correlatable line anywhere.
  | { status: "unknown"; reason: string };

function teamAllowlistStateFromResult(
  result: TeamModelAllowlistResult
): TeamAllowlistState {
  if (!result.ok) {
    return {
      status: "unknown",
      reason: result.reason ?? "allowlist read failed",
    };
  }
  if (!result.allowlist) return { status: "unrestricted" };
  return { status: "restricted", models: result.allowlist };
}

// Jittered so a fleet-wide blip does not produce a synchronized retry wave
// arriving at the database in lockstep.
const ALLOWLIST_RETRY_BASE_DELAY_MS = 50;
const ALLOWLIST_RETRY_JITTER_MS = 50;

function allowlistRetryDelayMs() {
  // Retry jitter, not a security decision: nothing is derived from this value
  // and predicting it gains an attacker nothing. node:crypto is avoided because
  // this module is reachable from client bundles.
  // eslint-disable-next-line sonarjs/pseudo-random
  const jitter = Math.floor(Math.random() * ALLOWLIST_RETRY_JITTER_MS);
  return ALLOWLIST_RETRY_BASE_DELAY_MS + jitter;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// This read is on the critical path of every team-scoped invocation and a
// failure denies the call, so a sustained outage would otherwise log once per
// request. Dedupe over a short window: enough to keep a repeated failure
// represented in the logs without flooding them at request rate.
//
// Per process, not global. On horizontally-scaled serverless the effective rate
// is one emission per (scope, team, cause) per window *per instance*, so an
// operator counting rows is counting instances that saw the failure, not
// distinct denials — the audit row's `throttled` marker says the same thing.
// Deliberate: a shared counter would mean a coordination round-trip on the
// failure path, which is the last place to add one.
export const ALLOWLIST_FAILURE_LOG_TTL_MS = 60 * 1000;
const ALLOWLIST_FAILURE_LOG_MAX_ENTRIES = 128;
// One map per scope. A single shared map lets one noisy surface — or one team
// churning distinct causes — consume the whole budget and hard-suppress first
// occurrences for every other scope, which is the opposite of what a diagnostic
// should do under a broad incident. Per-scope caps make starvation impossible
// across surfaces; within a scope the cap still applies.
type AllowlistSignalSlot = {
  claimedAt: number;
  /** Emissions refused since this slot was last granted. */
  suppressed: number;
};

const allowlistFailureLogsByScope = new Map<
  string,
  Map<string, AllowlistSignalSlot>
>();

function allowlistFailureLogFor(scope: string) {
  const existing = allowlistFailureLogsByScope.get(scope);
  if (existing) return existing;
  const created = new Map<string, AllowlistSignalSlot>();
  allowlistFailureLogsByScope.set(scope, created);
  return created;
}

/**
 * Module-level state, so a test asserting on the log would otherwise be
 * order-dependent within a process: a second failing read for the same team and
 * message inside the TTL window logs nothing.
 */
export function __resetAllowlistFailureLogForTests() {
  allowlistFailureLogsByScope.clear();
}

/**
 * Shared suppression for allowlist-degradation logs. Exported so surfaces that
 * degrade rather than deny (new-arrivals drops a scope) get the same anti-flood
 * treatment — they are polled, so an un-deduped line there floods at request
 * rate just as badly as one on the read itself.
 *
 * `scope` separates each surface's lines so one cannot suppress another's.
 */
export function logAllowlistDegradationOnce(
  scope: string,
  teamId: string,
  message: string,
  log: (message: string, fields: Record<string, unknown>) => void
) {
  const slot = claimAllowlistSignalSlot(scope, teamId, message);
  if (!slot.emit) return;
  log(`[${scope}] allowlist unavailable`, {
    teamId,
    reason: message,
    ...(slot.suppressedSinceLast > 0
      ? { suppressedSinceLast: slot.suppressedSinceLast }
      : {}),
  });
}

/**
 * Claims the emission slot for one (scope, team, cause) per window: grants at
 * most once per window and **records the claim as it does so**. Named `claim…`
 * rather than `shouldEmit…` because it mutates — calling it twice to decide two
 * side effects would silently suppress the second, so a single call must gate
 * everything that fires together.
 *
 * A granted slot reports `suppressedSinceLast`: how many emissions the previous
 * window refused. Without it a throttled row is a sample of unknown size, and
 * an operator cannot tell one denial from a thousand.
 *
 * Shared with the logs above so one window governs all of them.
 *
 * Exists because the denial path was amplifying load against the very
 * dependency that had just failed: during a sustained outage every team-scoped
 * invocation wrote an audit row back to the same Supabase instance whose read
 * had failed — a write that is least likely to succeed at exactly that moment —
 * plus an un-deduped log line. `model_not_in_allowlist` deliberately does NOT
 * use this: that is a real policy decision about a specific call, not a
 * repeated symptom of one outage.
 */
export function claimAllowlistSignalSlot(
  scope: string,
  teamId: string,
  message: string
) {
  return shouldLogAllowlistFailure(scope, teamId, message);
}

/**
 * Reduce a failure message to its cause. Postgres text routinely embeds
 * variable detail — timeout values, backend PIDs, connection ids, statement
 * fragments — so keying the throttle on the raw string would give every attempt
 * a distinct key: the throttle would stop throttling exactly during the outage
 * it exists for, and one noisy team could fill the shared cap and suppress
 * first occurrences for everyone else.
 *
 * Digits, UUIDs and quoted fragments go; the remaining shape is what
 * distinguishes "connection reset" from "permission denied", which is the
 * distinction the key is there to preserve.
 */
function allowlistFailureCauseKey(message: string) {
  return message
    .toLowerCase()
    .replaceAll(
      /[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}/g,
      "<uuid>"
    )
    .replaceAll(/"[^"]*"/g, "<q>")
    .replaceAll(/\d+/g, "<n>")
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/**
 * True when this (subject, cause) pair has not been logged inside the TTL.
 * Records it as logged when it returns true.
 *
 * Keyed on subject *and* cause: a team that hits a connection error and then a
 * permission error inside the same window should surface both — the second
 * cause is usually the informative one. Keying on the subject alone would
 * suppress it while still calling the flood solved. Keying on the raw message
 * would do the opposite; see allowlistFailureCauseKey.
 */
function shouldLogAllowlistFailure(
  scope: string,
  subject: string,
  message: string
): { emit: false } | { emit: true; suppressedSinceLast: number } {
  const loggedAllowlistFailures = allowlistFailureLogFor(scope);
  const now = Date.now();
  const key = `${subject}\u0000${allowlistFailureCauseKey(message)}`;
  const held = loggedAllowlistFailures.get(key);
  if (held && held.claimedAt > now - ALLOWLIST_FAILURE_LOG_TTL_MS) {
    // Count what the window is hiding so the next emission can report it. A
    // throttled compliance row that cannot say how much it stands for is a
    // sample of unknown size.
    held.suppressed += 1;
    return { emit: false };
  }
  // Sweep expired entries before deciding whether there is room. Only expired
  // ones — evicting a live claim would re-open its slot and let the next call
  // emit again, which under a broad multi-team outage partially restores the
  // very amplification this exists to prevent.
  if (loggedAllowlistFailures.size >= ALLOWLIST_FAILURE_LOG_MAX_ENTRIES) {
    for (const [entryKey, at] of loggedAllowlistFailures) {
      if (at.claimedAt <= now - ALLOWLIST_FAILURE_LOG_TTL_MS) {
        loggedAllowlistFailures.delete(entryKey);
      }
    }
  }

  // Still full of live claims: suppress rather than evict. A throttle exists to
  // bound writes, so under pressure it must fail toward emitting less, never
  // more. The cost is that a 129th distinct (scope, team, cause) inside one
  // window goes unlogged until a slot expires — acceptable, because reaching
  // that means a broad incident which the first 128 lines already describe.
  if (loggedAllowlistFailures.size >= ALLOWLIST_FAILURE_LOG_MAX_ENTRIES) {
    return { emit: false };
  }

  const suppressedSinceLast = held?.suppressed ?? 0;
  loggedAllowlistFailures.set(key, { claimedAt: now, suppressed: 0 });
  return { emit: true, suppressedSinceLast };
}

function logAllowlistFailureOnce(teamId: string, message: string) {
  const slot = shouldLogAllowlistFailure("read", teamId, message);
  if (!slot.emit) return;
  console.error("Team model allowlist lookup failed", {
    teamId,
    message,
    ...(slot.suppressedSinceLast > 0
      ? { suppressedSinceLast: slot.suppressedSinceLast }
      : {}),
  });
}

/**
 * Allowlist read that keeps the failure case distinguishable. A missing team
 * row is reported as `ok: true` with a null allowlist — there is genuinely no
 * restriction to violate — so only a failed read is `ok: false`.
 *
 * Retries once, does not cache. These were rejected for different reasons and
 * an earlier version of this comment wrongly bundled them:
 *
 *   * A cache is refused on staleness. This is a governance control, so a
 *     positive TTL cache means an admin tightening the allowlist does not take
 *     effect until it expires — and that window is exactly when the control
 *     matters. No amount of tuning makes that trade good here.
 *   * A retry has no staleness at all: it re-reads the same live row. Since
 *     this read is on the critical path of every team-scoped invocation and a
 *     failure now denies the call, one immediate retry absorbs the common
 *     transient blip at zero correctness cost. Bounded at one — beyond that we
 *     are queueing on an already-struggling database, and the automation path
 *     retries at the task level anyway.
 */
async function readTeamModelAllowlistOnce(
  teamId: string
): Promise<TeamModelAllowlistResult> {
  // try/catch, not just the `error` field: postgrest-js normalises fetch
  // rejections into `error` today, but a throw from the dynamic import or the
  // client itself would escape as an untagged exception — no
  // MODEL_ALLOWLIST_UNAVAILABLE_CODE, so the 503 mapping and the automation
  // classification both miss it and it lands back in the generic bucket this
  // PR exists to get it out of. Still fail-closed either way; the point is that
  // there is no untagged spelling of this read.
  try {
    const { supabaseAdmin } = await import("@/lib/supabase/admin");
    const { data, error } = await supabaseAdmin
      .from("teams")
      .select("model_allowlist")
      .eq("id", teamId)
      .maybeSingle();
    if (error) return { allowlist: null, ok: false, reason: error.message };
    if (!data) return { allowlist: null, ok: true };
    const allowlist = (data as { model_allowlist: string[] | null })
      .model_allowlist;
    return { allowlist: allowlist ?? null, ok: true };
  } catch (error) {
    return {
      allowlist: null,
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Allowlist state for a team scope. There is deliberately no variant that
 * returns a bare `readonly string[] | null`: the previous one
 * (`loadTeamModelAllowlist`) reported a failed read as null, which every
 * consumer then read as "unrestricted" — a governance control that failed open
 * on a transient database error (#764).
 *
 * `read` is injectable only so the retry and the failure paths are testable;
 * production always uses the default.
 */
export function createLoadTeamAllowlistState(
  read: (
    teamId: string
  ) => Promise<TeamModelAllowlistResult> = readTeamModelAllowlistOnce
) {
  return async function loadTeamAllowlistState(
    teamId: string
  ): Promise<TeamAllowlistState> {
    const first = await read(teamId);
    if (first.ok) return teamAllowlistStateFromResult(first);

    // Short pause before the retry. Re-reading immediately mostly just hits the
    // same condition — a lock wait or a connection blip needs a moment to
    // clear — and it doubles read load on a database that is already
    // struggling. Small enough to stay invisible on a request path that only
    // reaches it on failure.
    await sleep(allowlistRetryDelayMs());

    const retried = await read(teamId);
    if (retried.ok) return teamAllowlistStateFromResult(retried);

    // Logged after the retry, not before, so a blip the retry absorbed is never
    // reported as a failure.
    logAllowlistFailureOnce(teamId, retried.reason ?? "unknown error");
    return teamAllowlistStateFromResult(retried);
  };
}

export const loadTeamAllowlistState = createLoadTeamAllowlistState();

/**
 * True when `modelId` is permitted by a known allowlist. Unknown → false.
 *
 * Linear in the allowlist, so use `teamAllowlistMatcher` when testing more than
 * a handful of ids against the same state.
 */
export function allowlistPermitsModel(
  state: TeamAllowlistState,
  modelId: string
): boolean {
  if (state.status === "unrestricted") return true;
  if (state.status === "unknown") return false;
  return state.models.includes(modelId);
}

/**
 * `allowlistPermitsModel` with the Set built once. For filtering a whole
 * catalog the per-item `includes` scan is O(catalog x allowlist); this keeps
 * one spelling of the policy while restoring the O(1) membership test the
 * hand-rolled Sets at those call sites used to have.
 */
export function teamAllowlistMatcher(
  state: TeamAllowlistState
): (modelId: string) => boolean {
  if (state.status === "unrestricted") return () => true;
  if (state.status === "unknown") return () => false;
  const permitted = new Set(state.models);
  return (modelId) => permitted.has(modelId);
}

/**
 * Header the browser sets when an action is taken inside a team scope. Empty
 * / missing = solo. Proxy.ts can't inject scope headers on `/api/*` (it
 * short-circuits before slug resolution), so the client is the source of
 * truth for the active team on API calls.
 */
export const ACTIVE_TEAM_HEADER = "x-mogplex-team-id";

export function readActiveTeamIdHeader(request: Request): string | null {
  const raw = request.headers.get(ACTIVE_TEAM_HEADER);
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Treat malformed values as absent so a non-UUID header degrades to personal
  // scope rather than reaching Postgres and raising 22P02 invalid_text_representation.
  if (!isUuid(trimmed)) return null;
  return trimmed;
}

/**
 * Derive the capability string for a model id. Format `models.<provider>.<rest>`
 * with `<rest>` defaulting to the whole id when there's no provider/ prefix.
 */
export function modelCapability(modelId: string): Capability {
  const trimmed = modelId.trim();
  const [provider, ...rest] = trimmed.split("/");
  if (!provider) return `models.${trimmed}`;
  const remainder = rest.join("/");
  return remainder ? `models.${provider}.${remainder}` : `models.${provider}`;
}
