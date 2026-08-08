import { supabaseAdmin } from "@/lib/supabase/admin";
import { findBillingAccountForScope } from "@/lib/billing/accounts";
import { getBillingBalance } from "@/lib/billing/ledger";
import { resolveActiveTeamCapabilities } from "@/lib/team-capabilities";

export type PlatformAccess = {
  allowPlatformAi: boolean;
  allowPlatformSandbox: boolean;
};

export type PlatformAccessProfile = {
  id: string;
  email: string | null;
  allow_platform_ai?: boolean | null;
  allow_platform_sandbox?: boolean | null;
};

type LoadUserPlatformAccessDeps = {
  env: NodeJS.ProcessEnv;
  loadProfile: (userId: string) => Promise<PlatformAccessProfile | null>;
  loadBillingAccess: (
    userId: string,
    productTeamId?: string | null
  ) => Promise<boolean>;
  loadTeamMembership: (
    userId: string,
    productTeamId: string
  ) => Promise<boolean>;
};

type LoadExplicitPlatformAccessDeps = Pick<
  LoadUserPlatformAccessDeps,
  "env" | "loadProfile"
>;

type BillingAccessCacheEntry = {
  expiresAt: number;
  value: Promise<boolean>;
};

type ProfileAccessCacheEntry = {
  expiresAt: number;
  value: Promise<PlatformAccess>;
};

const PLATFORM_ACCESS_USER_IDS_ENV = "PLATFORM_ACCESS_USER_IDS";
const PLATFORM_ACCESS_EMAILS_ENV = "PLATFORM_ACCESS_EMAILS";
const PLATFORM_ACCESS_EMAIL_DOMAINS_ENV = "PLATFORM_ACCESS_EMAIL_DOMAINS";

const BUILT_IN_ALLOWLISTED_EMAIL_DOMAINS = ["blackbox.ai"] as const;
// Balance reads are hot and can tolerate webhook-scale staleness. Membership
// is deliberately checked outside this cache so removals take effect at once.
const BILLING_ACCESS_CACHE_TTL_MS = 5_000;
const BILLING_ACCESS_CACHE_MAX_ENTRIES = 256;
const PROFILE_ACCESS_CACHE_TTL_MS = 5_000;
const PROFILE_ACCESS_CACHE_MAX_ENTRIES = 256;

export const PLATFORM_AI_ACCESS_ERROR =
  "Hosted AI requires a positive billing balance. Add funds or choose a plan in Settings > Billing, or add your own AI Gateway or provider key in Settings > API Keys.";

export const PLATFORM_OPENAI_ACCESS_ERROR =
  "Hosted AI requires a positive billing balance. Add funds or choose a plan in Settings > Billing, or add your own OpenAI or AI Gateway key in Settings > API Keys.";

export const PLATFORM_ANTHROPIC_ACCESS_ERROR =
  "Hosted AI requires a positive billing balance. Add funds or choose a plan in Settings > Billing, or add your own Anthropic or AI Gateway key in Settings > API Keys.";

export const PLATFORM_OPENROUTER_ACCESS_ERROR =
  "Hosted AI requires a positive billing balance. Add funds or choose a plan in Settings > Billing, or add your own OpenRouter or AI Gateway key in Settings > API Keys.";

export const PLATFORM_SANDBOX_ACCESS_ERROR =
  "Hosted sandbox compute requires a positive billing balance. Add funds or choose a plan in Settings > Billing.";

export const PLATFORM_SANDBOX_RECORD_ACCESS_ERROR =
  "Hosted sandbox compute requires a positive billing balance. Add funds or choose a plan in Settings > Billing.";

function parseAllowlist(
  value: string | undefined,
  options?: { lowercase?: boolean }
) {
  return new Set(
    (value || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => (options?.lowercase ? entry.toLowerCase() : entry))
  );
}

function parseDomainAllowlist(value: string | undefined) {
  const fromEnv = (value || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .map((entry) => (entry.startsWith("@") ? entry.slice(1) : entry))
    .filter(Boolean);

  return new Set([...BUILT_IN_ALLOWLISTED_EMAIL_DOMAINS, ...fromEnv]);
}

function getEmailDomain(email: string | null) {
  if (!email) return null;

  const atIndex = email.lastIndexOf("@");
  if (atIndex === -1 || atIndex === email.length - 1) return null;

  return email.slice(atIndex + 1);
}

const DEFAULT_ALLOWLISTED_USER_IDS = parseAllowlist(
  process.env[PLATFORM_ACCESS_USER_IDS_ENV]
);
const DEFAULT_ALLOWLISTED_EMAILS = parseAllowlist(
  process.env[PLATFORM_ACCESS_EMAILS_ENV],
  { lowercase: true }
);
const DEFAULT_ALLOWLISTED_EMAIL_DOMAINS = parseDomainAllowlist(
  process.env[PLATFORM_ACCESS_EMAIL_DOMAINS_ENV]
);

export function derivePlatformAccess(
  profile: PlatformAccessProfile | null,
  env: NodeJS.ProcessEnv = process.env
): PlatformAccess {
  const usesDefaultEnv = env === process.env;
  const allowlistedUserIds = usesDefaultEnv
    ? DEFAULT_ALLOWLISTED_USER_IDS
    : parseAllowlist(env[PLATFORM_ACCESS_USER_IDS_ENV]);
  const allowlistedEmails = usesDefaultEnv
    ? DEFAULT_ALLOWLISTED_EMAILS
    : parseAllowlist(env[PLATFORM_ACCESS_EMAILS_ENV], { lowercase: true });
  const allowlistedEmailDomains = usesDefaultEnv
    ? DEFAULT_ALLOWLISTED_EMAIL_DOMAINS
    : parseDomainAllowlist(env[PLATFORM_ACCESS_EMAIL_DOMAINS_ENV]);
  const email = profile?.email?.trim().toLowerCase() || null;
  const emailDomain = getEmailDomain(email);
  const allowlisted =
    (profile?.id ? allowlistedUserIds.has(profile.id) : false) ||
    (email ? allowlistedEmails.has(email) : false) ||
    (emailDomain ? allowlistedEmailDomains.has(emailDomain) : false);

  return {
    allowPlatformAi: allowlisted || Boolean(profile?.allow_platform_ai),
    allowPlatformSandbox:
      allowlisted || Boolean(profile?.allow_platform_sandbox),
  };
}

async function loadPlatformAccessProfile(
  userId: string
): Promise<PlatformAccessProfile | null> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id, email, allow_platform_ai, allow_platform_sandbox")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load platform access profile: ${error.message}`);
  }

  return (data ?? null) as PlatformAccessProfile | null;
}

async function resolveExplicitPlatformAccess(
  userId: string,
  deps: LoadExplicitPlatformAccessDeps
): Promise<PlatformAccess> {
  const profile = await deps.loadProfile(userId);
  return derivePlatformAccess(
    profile ?? {
      id: userId,
      email: null,
      allow_platform_ai: false,
      allow_platform_sandbox: false,
    },
    deps.env
  );
}

export function createLoadExplicitPlatformAccess(
  overrides: Partial<LoadExplicitPlatformAccessDeps> = {}
) {
  const deps: LoadExplicitPlatformAccessDeps = {
    env: process.env,
    loadProfile: loadPlatformAccessProfile,
    ...overrides,
  };
  const cache = new Map<string, ProfileAccessCacheEntry>();

  return async function loadExplicitPlatformAccess(
    userId: string
  ): Promise<PlatformAccess> {
    const now = Date.now();
    const cached = cache.get(userId);
    if (cached && cached.expiresAt > now) return cached.value;
    if (cached) cache.delete(userId);
    reclaimPromiseCache(cache, now, PROFILE_ACCESS_CACHE_MAX_ENTRIES);
    const entry: ProfileAccessCacheEntry = {
      expiresAt: now + PROFILE_ACCESS_CACHE_TTL_MS,
      value: Promise.resolve().then(() =>
        resolveExplicitPlatformAccess(userId, deps)
      ),
    };
    cache.set(userId, entry);
    void entry.value.catch(() => {
      if (cache.get(userId) === entry) cache.delete(userId);
    });
    return entry.value;
  };
}

export const loadExplicitPlatformAccess = createLoadExplicitPlatformAccess();

// The credit ledger in the database is the source of truth for balances, and
// this must stay readable from processes that never hold the Stripe secret
// (the Trigger.dev workers run automations but only Vercel serves the Stripe
// webhooks/checkout). Deployments without Stripe configured simply have no
// positive balances, so no gate on the Stripe key is needed here.
async function loadBillingAccess(
  userId: string,
  productTeamId?: string | null
): Promise<boolean> {
  const scope = productTeamId
    ? ({
        kind: "team",
        userId,
        productTeamId,
      } as const)
    : ({ kind: "personal", userId, productTeamId: null } as const);
  const account = await findBillingAccountForScope(scope);
  if (!account) return false;

  const balance = await getBillingBalance(account.id);
  return balance.totalCents > 0;
}

async function loadTeamMembership(
  userId: string,
  productTeamId: string
): Promise<boolean> {
  const resolution = await resolveActiveTeamCapabilities(userId, productTeamId);
  return resolution.ok;
}

function billingAccessCacheKey(
  userId: string,
  productTeamId?: string | null
): string {
  return productTeamId ? `team:${productTeamId}` : `user:${userId}`;
}

function reclaimPromiseCache<T extends { expiresAt: number }>(
  cache: Map<string, T>,
  now: number,
  maxEntries: number
) {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  if (cache.size < maxEntries) return;
  const oldestKey = cache.keys().next().value as string | undefined;
  if (oldestKey) cache.delete(oldestKey);
}

export function createLoadUserPlatformAccess(
  overrides: Partial<LoadUserPlatformAccessDeps> = {}
) {
  const deps: LoadUserPlatformAccessDeps = {
    env: process.env,
    loadProfile: loadPlatformAccessProfile,
    loadBillingAccess,
    loadTeamMembership,
    ...overrides,
  };
  const billingAccessCache = new Map<string, BillingAccessCacheEntry>();
  const profileAccessCache = new Map<string, ProfileAccessCacheEntry>();

  function loadCachedExplicitAccess(userId: string): Promise<PlatformAccess> {
    const now = Date.now();
    const cached = profileAccessCache.get(userId);
    if (cached && cached.expiresAt > now) return cached.value;
    if (cached) profileAccessCache.delete(userId);

    reclaimPromiseCache(
      profileAccessCache,
      now,
      PROFILE_ACCESS_CACHE_MAX_ENTRIES
    );
    const entry: ProfileAccessCacheEntry = {
      expiresAt: now + PROFILE_ACCESS_CACHE_TTL_MS,
      value: Promise.resolve().then(() =>
        resolveExplicitPlatformAccess(userId, deps)
      ),
    };
    profileAccessCache.set(userId, entry);
    void entry.value.catch(() => {
      if (profileAccessCache.get(userId) === entry) {
        profileAccessCache.delete(userId);
      }
    });
    return entry.value;
  }

  function loadCachedBillingAccess(
    userId: string,
    productTeamId?: string | null
  ): Promise<boolean> {
    const key = billingAccessCacheKey(userId, productTeamId);
    const now = Date.now();
    const cached = billingAccessCache.get(key);
    if (cached && cached.expiresAt > now) return cached.value;
    if (cached) billingAccessCache.delete(key);

    reclaimPromiseCache(
      billingAccessCache,
      now,
      BILLING_ACCESS_CACHE_MAX_ENTRIES
    );
    const entry: BillingAccessCacheEntry = {
      expiresAt: now + BILLING_ACCESS_CACHE_TTL_MS,
      value: Promise.resolve().then(() =>
        deps.loadBillingAccess(userId, productTeamId)
      ),
    };
    billingAccessCache.set(key, entry);
    void entry.value.catch(() => {
      if (billingAccessCache.get(key) === entry) billingAccessCache.delete(key);
    });
    return entry.value;
  }

  return async function loadUserPlatformAccess(
    userId: string,
    productTeamId?: string | null,
    loadedProfile?: PlatformAccessProfile | null
  ): Promise<PlatformAccess> {
    const allowlistedAccess = loadedProfile
      ? derivePlatformAccess(loadedProfile, deps.env)
      : await loadCachedExplicitAccess(userId);
    // Explicit grants belong to the actor, not a billing scope. An approved
    // operator remains exempt while acting inside any team; team membership
    // only gates access obtained from that team's funded billing account.
    if (
      allowlistedAccess.allowPlatformAi &&
      allowlistedAccess.allowPlatformSandbox
    ) {
      return allowlistedAccess;
    }

    if (
      productTeamId &&
      !(await deps.loadTeamMembership(userId, productTeamId))
    ) {
      return allowlistedAccess;
    }

    const hasBillingAccess = await loadCachedBillingAccess(
      userId,
      productTeamId
    );
    return {
      allowPlatformAi: allowlistedAccess.allowPlatformAi || hasBillingAccess,
      allowPlatformSandbox:
        allowlistedAccess.allowPlatformSandbox || hasBillingAccess,
    };
  };
}

export const loadUserPlatformAccess = createLoadUserPlatformAccess();
