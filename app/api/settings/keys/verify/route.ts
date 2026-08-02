import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { getProviderKey } from "@/lib/vault";
import { HARNESSES } from "@/lib/harness/config";
import type { Provider } from "@/lib/vault";
import type { HarnessId } from "@/lib/harness/config";

const VALID_PROVIDERS = new Set<Provider>([
  "ai_gateway",
  "anthropic",
  "openai",
  "openrouter",
]);

const PROVIDER_TO_HARNESS: Partial<Record<Provider, HarnessId>> = {
  anthropic: "claude-code",
  openai: "codex",
};

type ApiKeyVerificationResult = { valid: boolean | null; error?: string };

async function verifyOpenRouterApiKey(
  apiKey: string
): Promise<ApiKeyVerificationResult> {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/auth/key", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    // TODO: Surface /auth/key metadata when Settings displays OpenRouter account limits.
    if (res.status === 401 || res.status === 403) {
      return { valid: false, error: "Invalid API key" };
    }
    if (res.status === 429) {
      return { valid: true };
    }
    if (res.ok) {
      return { valid: true };
    }
    if (res.status >= 500) {
      return { valid: null, error: "OpenRouter is unavailable; try again" };
    }
    return {
      valid: null,
      error: `OpenRouter verification failed (${res.status}); try again`,
    };
  } catch {
    return { valid: null, error: "OpenRouter is unavailable; try again" };
  }
}

/** Ping the provider API to check if the key is valid. */
export async function verifyApiKey(
  provider: Provider,
  apiKey: string
): Promise<ApiKeyVerificationResult> {
  if (provider === "openrouter") {
    return await verifyOpenRouterApiKey(apiKey);
  }

  try {
    if (provider === "ai_gateway") {
      const res = await fetch("https://ai-gateway.vercel.sh/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.status === 401 || res.status === 403) {
        return { valid: false, error: "Invalid API key" };
      }
      return { valid: res.ok || res.status === 429 };
    }

    if (provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1,
          messages: [{ role: "user", content: "hi" }],
        }),
      });
      // 200 = valid key, 401/403 = bad key, 400 = valid key (bad request is fine)
      if (res.status === 401 || res.status === 403) {
        return { valid: false, error: "Invalid API key" };
      }
      if (res.status === 429) {
        return { valid: true }; // rate limited means key is valid
      }
      return { valid: res.ok || res.status === 400 };
    }

    if (provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.status === 401) {
        return { valid: false, error: "Invalid API key" };
      }
      return { valid: res.ok || res.status === 429 };
    }

    return { valid: false, error: "Unknown provider" };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : "Network error",
    };
  }
}

type VerifyChecks = {
  key_stored: boolean;
  key_valid: boolean | null;
  key_error?: string;
  service: string;
  harness?: string;
  package?: string;
  binary?: string;
};

type SettingsKeysVerifyDeps = {
  requireUserId: typeof requireUserId;
  getProviderKey: typeof getProviderKey;
  verifyApiKey: typeof verifyApiKey;
};

const defaultSettingsKeysVerifyDeps: SettingsKeysVerifyDeps = {
  requireUserId,
  getProviderKey,
  verifyApiKey,
};

function buildVerifyChecks(provider: Provider): VerifyChecks {
  const harnessId = PROVIDER_TO_HARNESS[provider];
  if (!harnessId) {
    return {
      key_stored: false,
      key_valid: null,
      service: provider === "openrouter" ? "OpenRouter" : "Vercel AI Gateway",
    };
  }

  const harness = HARNESSES[harnessId];
  return {
    key_stored: false,
    key_valid: null,
    service: harness.name,
    harness: harness.name,
    package: harness.package,
    binary: harness.binary,
  };
}

export function createSettingsKeysVerifyPostHandler(
  overrides: Partial<SettingsKeysVerifyDeps> = {}
) {
  const deps: SettingsKeysVerifyDeps = {
    ...defaultSettingsKeysVerifyDeps,
    ...overrides,
  };

  return async function POST(request: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    let body: { provider?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { provider } = body;
    if (!provider || !VALID_PROVIDERS.has(provider as Provider)) {
      return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
    }

    const typedProvider = provider as Provider;
    const checks = buildVerifyChecks(typedProvider);

    let vaultKey: string | null;
    try {
      vaultKey = await deps.getProviderKey(userId, typedProvider);
    } catch (err) {
      return NextResponse.json({
        ...checks,
        key_error: err instanceof Error ? err.message : "Vault read failed",
      });
    }

    checks.key_stored = Boolean(vaultKey);

    if (!vaultKey) {
      return NextResponse.json(checks);
    }

    const keyResult = await deps.verifyApiKey(typedProvider, vaultKey);
    checks.key_valid = keyResult.valid;
    if (keyResult.error) checks.key_error = keyResult.error;

    return NextResponse.json(checks);
  };
}

export const POST = createSettingsKeysVerifyPostHandler();
