import { supabaseAdmin } from "@/lib/supabase/admin";

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
};

const PLATFORM_ACCESS_USER_IDS_ENV = "PLATFORM_ACCESS_USER_IDS";
const PLATFORM_ACCESS_EMAILS_ENV = "PLATFORM_ACCESS_EMAILS";
const PLATFORM_ACCESS_EMAIL_DOMAINS_ENV = "PLATFORM_ACCESS_EMAIL_DOMAINS";

const BUILT_IN_ALLOWLISTED_EMAIL_DOMAINS = ["blackbox.ai"] as const;

export const PLATFORM_AI_ACCESS_ERROR =
  "Platform AI access is not enabled for this account. Add your own AI Gateway key or provider key in Settings > API Keys.";

export const PLATFORM_OPENAI_ACCESS_ERROR =
  "Platform AI access is not enabled for this account. Add your own OpenAI API key or AI Gateway key in Settings > API Keys.";

export const PLATFORM_ANTHROPIC_ACCESS_ERROR =
  "Platform AI access is not enabled for this account. Add your own Anthropic API key or AI Gateway key in Settings > API Keys.";

export const PLATFORM_OPENROUTER_ACCESS_ERROR =
  "Platform AI access is not enabled for this account. Add your own OpenRouter API key in Settings > API Keys or select a model backed by your AI Gateway key.";

export const PLATFORM_SANDBOX_ACCESS_ERROR =
  "Platform sandbox billing is not enabled for this account. Link Personal Vercel and select a billing project to launch sandboxes.";

export const PLATFORM_SANDBOX_RECORD_ACCESS_ERROR =
  "Platform sandbox access is not enabled for this account. Relaunch this repo with a personal Vercel billing project to keep using sandbox tools.";

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
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("id, email, allow_platform_ai, allow_platform_sandbox")
    .eq("id", userId)
    .maybeSingle();

  return (data ?? null) as PlatformAccessProfile | null;
}

export function createLoadUserPlatformAccess(
  overrides: Partial<LoadUserPlatformAccessDeps> = {}
) {
  const deps: LoadUserPlatformAccessDeps = {
    env: process.env,
    loadProfile: loadPlatformAccessProfile,
    ...overrides,
  };

  return async function loadUserPlatformAccess(
    userId: string
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
  };
}

export const loadUserPlatformAccess = createLoadUserPlatformAccess();
