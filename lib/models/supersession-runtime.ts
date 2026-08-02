import {
  buildSupersessionMap,
  resolveUpgradedModelId,
  type ModelSupersessionRow,
} from "@/lib/models/model-supersessions";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { TeamAllowlistState } from "@/lib/team-capabilities";

// Runtime half of the deprecated-model upgrade. The SQL reconciler rewrites the
// mutable pins (draft graphs, agent base models, default models), but published
// flow_versions.graph rows are immutable snapshots that runs execute — so a
// published automation would keep invoking a retired model until someone
// republished it. Resolving at invocation time closes that gap without
// mutating version history.
//
// Published automations are the half that actually executes, so a guard
// enforced only in SQL would be a guard that barely holds. The consent guards
// are therefore identical on both paths:
//
//   * supersession currently in effect -> model_supersessions_effective view
//     (successor on offer, deprecated model not)
//   * profiles.auto_enable_new_models -> loadUserUpgradeConsent
//   * successor not explicitly disabled by the user -> loadUserUpgradeConsent
//
// The team dimension deliberately differs, and the difference is not an
// oversight:
//
//   * SQL rewrites a *stored* pin that any of the user's teams might later run,
//     so it withholds the upgrade if any team permits the deprecated model and
//     forbids the successor. It cannot know which scope a future run will use.
//   * This path knows the scope of the run in hand, so it checks that scope's
//     allowlist only. A solo run is not governed by a team's allowlist, so it
//     applies no allowlist check at all — deliberately narrower than SQL, and
//     more accurate for the invocation actually happening.
//
// Do not "align" the two by giving this path the any-team check: that would
// block solo runs on an unrelated team's policy.
//
// Every guard fails closed: if we cannot establish that an upgrade is wanted,
// the pinned model is used unchanged. That is the pre-existing behaviour, and
// silently overriding an opt-out is worse than leaving a stale pin in place.
//
// Can a substituted successor then be refused by resolveUserLanguageModel,
// turning a run that would have executed into a hard failure? Its two gates:
//
//   * team allowlist — checked here too, against the same scope, so a successor
//     that would be refused is never substituted.
//   * member capability — `modelCapability()` is per-model-id, but every role
//     preset grants `models.*`, so no role can hold the deprecated model's
//     capability without also holding the successor's. If per-model capability
//     grants ever land (#431), this stops being true and the capability set has
//     to be threaded in here the way the allowlist already is.
//
// It does *not* gate on user_model_preferences or repo_model_overrides, so the
// consent read below is the only thing consulting those — the asymmetry is in
// the safe direction (we check more than the gate does, not less).

const CACHE_TTL_MS = 5 * 60 * 1000;

// A failed load is retried far sooner than a successful one is refreshed, but
// not on literally every resolve: during a sustained outage an automation with
// many superseded nodes would otherwise hammer an already-struggling database.
// At cron/run timescales 15s is still effectively immediate recovery.
const FAILURE_CACHE_TTL_MS = 15 * 1000;

// Chosen for opt-out responsiveness, not for batching. It does collapse
// resolutions that land close together (parallel nodes, a retried step), but an
// agent step usually runs longer than this, so a long sequential automation will
// still re-read per superseded node — two indexed single-row reads, and only for
// pins that are actually superseded, which is not worth trading a slower opt-out
// for. Don't read this as a per-run memo; it isn't one.
const CONSENT_CACHE_TTL_MS = 5 * 1000;

// How often the same from->to substitution is re-logged. Long enough that a
// multi-node run logs it once, short enough that each run is represented.
const SUBSTITUTION_LOG_TTL_MS = 60 * 1000;
const SUBSTITUTION_LOG_MAX_ENTRIES = 128;

const EMPTY_MAP: ReadonlyMap<string, string> = new Map();

type LoadResult =
  | { ok: true; supersessions: ReadonlyMap<string, string> }
  | { ok: false };

type CacheEntry = {
  expiresAt: number;
  supersessions: Promise<ReadonlyMap<string, string>>;
};

let cache: CacheEntry | null = null;

async function loadSupersessionMap(): Promise<LoadResult> {
  // The view filters to successors the catalog is currently offering, so an
  // entry in this map is always safe to invoke.
  const { data, error } = await supabaseAdmin
    .from("model_supersessions_effective")
    .select("deprecated_model_id, successor_model_id");

  if (error) {
    // Never fail a run over this: an unresolved id is the pre-existing
    // behavior (invoke what was pinned), whereas throwing would take down
    // automations that have nothing to do with deprecated models.
    console.warn("[model-supersessions] load failed", {
      message: error.message,
    });
    return { ok: false };
  }

  const dropped: string[] = [];
  const supersessions = buildSupersessionMap(
    (data ?? []) as ModelSupersessionRow[],
    dropped
  );

  if (dropped.length > 0) {
    // Only reachable if model_supersessions has been corrupted into a cycle or
    // self-reference. Loud, because the alternative symptom is pins quietly
    // never upgrading with no explanation anywhere.
    console.error("[model-supersessions] unresolvable mappings dropped", {
      deprecatedModelIds: dropped,
    });
  }

  return { ok: true, supersessions };
}

function getSupersessionMap(): Promise<ReadonlyMap<string, string>> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.supersessions;

  // Both outcomes are cached, so concurrent resolves share one query rather
  // than stampeding the table — but a failed load gets a much shorter TTL
  // (FAILURE_CACHE_TTL_MS) than a successful one. That keeps recovery prompt
  // without hammering a struggling database: caching a failure for the full
  // success TTL would leave upgrades switched off long after the database
  // recovered, and silently, since an unresolved id looks identical to a model
  // that was never superseded. The entry-identity check below keeps the TTL
  // adjustment safe against a concurrent refresh having installed a newer entry.
  const entry: CacheEntry = {
    expiresAt: now + CACHE_TTL_MS,
    supersessions: Promise.resolve(EMPTY_MAP),
  };

  // On failure the entry is kept but its lifetime shortened to
  // FAILURE_CACHE_TTL_MS, so recovery is prompt without every resolve reissuing
  // the query mid-outage.
  const shortenIfCurrent = () => {
    if (cache === entry) entry.expiresAt = Date.now() + FAILURE_CACHE_TTL_MS;
  };

  entry.supersessions = loadSupersessionMap()
    .then((result) => {
      if (!result.ok) {
        shortenIfCurrent();
        return EMPTY_MAP;
      }
      return result.supersessions;
    })
    .catch((error: unknown) => {
      shortenIfCurrent();
      console.warn("[model-supersessions] load threw", {
        message: error instanceof Error ? error.message : String(error),
      });
      return EMPTY_MAP;
    });

  // Cached before the load settles so concurrent resolves share one query
  // rather than stampeding the table.
  cache = entry;
  return entry.supersessions;
}

const consentCache = new Map<
  string,
  { expiresAt: number; consented: Promise<boolean> }
>();

/** Test seam — drops the cached state so a test can control what loads next. */
export function resetSupersessionCacheForTests() {
  cache = null;
  consentCache.clear();
  loggedSubstitutions.clear();
}

/**
 * Whether this user wants a pin upgraded onto `successorId` — the runtime
 * equivalent of the per-user guards in upgrade_deprecated_model_pins().
 *
 * Fails closed, so a read error leaves the pinned model alone.
 */
async function readUserUpgradeConsent(
  userId: string,
  successorId: string
): Promise<{ ok: boolean; consented: boolean }> {
  const [profile, preference] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("auto_enable_new_models")
      .eq("id", userId)
      .maybeSingle(),
    supabaseAdmin
      .from("user_model_preferences")
      .select("is_enabled")
      .eq("user_id", userId)
      .eq("model_id", successorId)
      .maybeSingle(),
  ]);

  if (profile.error || preference.error) {
    console.warn("[model-supersessions] consent lookup failed", {
      message: profile.error?.message ?? preference.error?.message,
    });
    // Fails closed, but reported as a failed read so it is not cached — a
    // transient error must not suppress upgrades for the rest of the TTL.
    return { ok: false, consented: false };
  }

  const autoEnable =
    (profile.data as { auto_enable_new_models?: boolean } | null)
      ?.auto_enable_new_models ?? false;
  if (!autoEnable) return { ok: true, consented: false };

  const isEnabled = (preference.data as { is_enabled?: boolean } | null)
    ?.is_enabled;
  return { ok: true, consented: isEnabled !== false };
}

const CONSENT_CACHE_MAX_ENTRIES = 512;

/**
 * Keep the consent cache genuinely bounded. Dropping expired entries alone is
 * not enough: a worker holding more than CONSENT_CACHE_MAX_ENTRIES *live* keys
 * inside one TTL window would reclaim nothing, grow without limit, and pay a
 * full iteration on every insert. After the expiry sweep, evict from the head —
 * Map iteration is insertion-ordered, so that is oldest-first — until the size
 * is back under the cap.
 */
function pruneConsentCache(now: number) {
  if (consentCache.size <= CONSENT_CACHE_MAX_ENTRIES) return;

  for (const [key, entry] of consentCache) {
    if (entry.expiresAt <= now) consentCache.delete(key);
  }

  for (const key of consentCache.keys()) {
    if (consentCache.size <= CONSENT_CACHE_MAX_ENTRIES) break;
    consentCache.delete(key);
  }
}

/**
 * Memoised consent, keyed on (user, successor). An automation with several agent
 * nodes pinned to the same retired model resolves each node separately, so
 * without this each run paid two sequential queries per node. The TTL is short
 * so a user changing the opt-out is picked up almost immediately.
 */
async function loadUserUpgradeConsent(
  userId: string,
  successorId: string
): Promise<boolean> {
  const key = `${userId}:${successorId}`;
  const now = Date.now();

  const cached = consentCache.get(key);
  if (cached && cached.expiresAt > now) return cached.consented;

  const forget = () => {
    if (consentCache.get(key) === entry) consentCache.delete(key);
  };

  // Cached before it settles so concurrent nodes share one read. Both failure
  // paths — a thrown error and an error result — drop the entry, so neither
  // keeps upgrades suppressed once the database recovers.
  const entry = {
    expiresAt: now + CONSENT_CACHE_TTL_MS,
    consented: readUserUpgradeConsent(userId, successorId)
      .then((result) => {
        if (!result.ok) forget();
        return result.consented;
      })
      .catch((error: unknown) => {
        forget();
        console.warn("[model-supersessions] consent lookup threw", {
          message: error instanceof Error ? error.message : String(error),
        });
        return false;
      }),
  };
  consentCache.set(key, entry);

  pruneConsentCache(now);

  return entry.consented;
}

// Substitutions already logged, with the same short TTL as consent so a
// long-lived worker re-reports periodically rather than once per process.
const loggedSubstitutions = new Map<string, number>();

function logSubstitutionOnce(userId: string, from: string, to: string) {
  // Keyed per user as well as per pair: one user's substitution must not
  // suppress another's, or a 60s window collapses several users' runs into a
  // single line that names none of them.
  const key = `${userId}:${from}>${to}`;
  const now = Date.now();
  const lastLoggedAt = loggedSubstitutions.get(key);
  if (
    lastLoggedAt !== undefined &&
    lastLoggedAt > now - SUBSTITUTION_LOG_TTL_MS
  ) {
    return;
  }

  loggedSubstitutions.set(key, now);
  // Same head-eviction as pruneConsentCache: dropping only stale entries would
  // reclaim nothing when more than the cap are live inside one window, and then
  // pay a full iteration on every insert.
  if (loggedSubstitutions.size > SUBSTITUTION_LOG_MAX_ENTRIES) {
    for (const [existingKey, at] of loggedSubstitutions) {
      if (at <= now - SUBSTITUTION_LOG_TTL_MS) {
        loggedSubstitutions.delete(existingKey);
      }
    }
    for (const existingKey of loggedSubstitutions.keys()) {
      if (loggedSubstitutions.size <= SUBSTITUTION_LOG_MAX_ENTRIES) break;
      loggedSubstitutions.delete(existingKey);
    }
  }

  console.log("[model-supersessions] upgraded pinned model", {
    userId,
    from,
    to,
  });
}

// Re-exported for the call sites that pair this resolver with the invocation
// gate. Defined in team-capabilities.ts, next to the read it describes, so the
// gate and the upgrade cannot drift onto two different notions of "unknown" —
// see the doc comment there, which is what hover shows at the call sites.
//
// An allowlist is a governance control, so the upgrade defers to it: silently
// swapping in a successor the team has not permitted would turn a working call
// into a MODEL_NOT_IN_ALLOWLIST_ERROR.
export type { TeamAllowlistState } from "@/lib/team-capabilities";

/**
 * Map a pinned model id onto its successor when the pinned model has been
 * retired in favour of a newer same-priced version, provided the owning user
 * (and the active team) actually want that. Unknown ids pass through
 * unchanged, so this is a no-op for the overwhelming majority of runs.
 *
 * `userId` is required rather than optional so the opt-out guard cannot be
 * skipped by omission at a call site.
 */
export async function resolveRuntimeModelId(
  userId: string,
  modelId: string,
  allowlist: TeamAllowlistState
): Promise<string> {
  const trimmed = modelId.trim();
  if (!trimmed) return modelId;

  const supersessions = await getSupersessionMap();
  const upgraded = resolveUpgradedModelId(trimmed, supersessions);
  // `modelId`, not `trimmed`: the trim exists only to look the pin up. Returning
  // the normalised form would quietly change what reaches
  // resolveUserLanguageModel and requestedModelId telemetry on *every* run, not
  // just superseded ones.
  if (upgraded === trimmed) return modelId;

  if (allowlist.status === "unknown") {
    console.warn("[model-supersessions] skipped upgrade, allowlist unknown", {
      from: trimmed,
      to: upgraded,
    });
    return modelId;
  }

  // An empty allowlist permits nothing, so it blocks the upgrade here — which
  // matches resolveUserLanguageModel's invocation gate (it rejects every model
  // against an empty allowlist) but is stricter than the SQL guard, whose
  // `@> ARRAY[deprecated]` test is false for []. The run fails either way; this
  // path just declines to change the pin first. Deliberate, listed here because
  // the header enumerates the intended divergences.
  if (
    allowlist.status === "restricted" &&
    !allowlist.models.includes(upgraded)
  ) {
    console.warn("[model-supersessions] skipped upgrade blocked by allowlist", {
      from: trimmed,
      to: upgraded,
    });
    return modelId;
  }

  if (!(await loadUserUpgradeConsent(userId, upgraded))) {
    console.log("[model-supersessions] skipped upgrade, user opted out", {
      from: trimmed,
      to: upgraded,
    });
    return modelId;
  }

  // ai_calls records the model that *ran* (effectiveModelId), which is what cost
  // and history need — but on its own it leaves "why did this run use Opus 5?"
  // unanswerable, because the pinned id appears nowhere. Log the substitution,
  // deduplicated per from->to so an automation with many superseded nodes does
  // not repeat it once per node on every run.
  logSubstitutionOnce(userId, trimmed, upgraded);
  return upgraded;
}
