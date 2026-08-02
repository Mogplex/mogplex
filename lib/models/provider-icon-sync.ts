import {
  getProviderIconPath,
  normalizeProvider,
  normalizeProviderIconProviders,
  PROVIDER_ICONS_BUCKET,
} from "@/lib/models/provider-icon";
import {
  listStoredProviderIcons,
  type StoredProviderIconsResult,
} from "@/lib/models/provider-icon-storage";
import { supabaseAdmin } from "@/lib/supabase/admin";

const AI_GATEWAY_PROVIDER_LOGO_BASE_URL =
  "https://7nyt0uhk7sse4zvn.public.blob.vercel-storage.com/docs-assets/static/docs/ai-gateway/logos";
const PROVIDER_ICON_FETCH_TIMEOUT_MS = 5000;
const MAX_PROVIDER_ICON_BYTES = 512 * 1024;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
export const PROVIDER_ICON_SYNC_CONCURRENCY = 5;
export const PROVIDER_ICON_REFRESH_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;

const AI_GATEWAY_PROVIDER_LOGO_NAME_OVERRIDES: Readonly<
  Record<string, string>
> = {
  alibaba: "alibaba cloud",
  amazon: "amazon bedrock",
};

type ProviderIconSyncDeps = {
  listStoredProviders: () => Promise<StoredProviderIconsResult>;
  now: () => number;
  fetchLogo: (url: string) => Promise<Response>;
  uploadLogo: (
    path: string,
    body: Uint8Array
  ) => Promise<{ error: { message: string } | null }>;
};

export type ProviderIconSyncResult = {
  attempted: number;
  skipped: number;
  upserted: number;
  failedProviders: string[];
};

export const PROVIDER_ICON_UPLOAD_OPTIONS = {
  cacheControl: "86400",
  contentType: "image/png",
  upsert: true,
} as const;

const defaultProviderIconSyncDeps: ProviderIconSyncDeps = {
  listStoredProviders: listStoredProviderIcons,
  now: Date.now,
  fetchLogo: (url) =>
    fetch(url, {
      headers: { accept: "image/png" },
      signal: AbortSignal.timeout(PROVIDER_ICON_FETCH_TIMEOUT_MS),
    }),
  async uploadLogo(path, body) {
    const { error } = await supabaseAdmin.storage
      .from(PROVIDER_ICONS_BUCKET)
      .upload(path, body, PROVIDER_ICON_UPLOAD_OPTIONS);
    return { error: error ? { message: error.message } : null };
  },
};

export function getAiGatewayProviderLogoUrl(provider: string) {
  const normalizedProvider = normalizeProvider(provider);
  if (!getProviderIconPath(normalizedProvider)) return null;

  const logoName =
    AI_GATEWAY_PROVIDER_LOGO_NAME_OVERRIDES[normalizedProvider] ??
    normalizedProvider;
  return `${AI_GATEWAY_PROVIDER_LOGO_BASE_URL}/${encodeURIComponent(logoName)}.png`;
}

function isValidPng(bytes: Uint8Array) {
  return (
    bytes.length > PNG_SIGNATURE.length &&
    PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
  );
}

function hasValidProviderLogoHeaders(response: Response) {
  if (!response.ok) return false;
  if (!response.headers.get("content-type")?.startsWith("image/png")) {
    return false;
  }

  const contentLength = Number(response.headers.get("content-length"));
  return (
    !Number.isFinite(contentLength) || contentLength <= MAX_PROVIDER_ICON_BYTES
  );
}

async function loadProviderLogo(
  provider: string,
  fetchLogo: ProviderIconSyncDeps["fetchLogo"]
) {
  const upstreamUrl = getAiGatewayProviderLogoUrl(provider);
  if (!upstreamUrl) return null;

  let response: Response;
  try {
    response = await fetchLogo(upstreamUrl);
  } catch {
    return null;
  }

  if (!hasValidProviderLogoHeaders(response)) return null;

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }

  if (bytes.length > MAX_PROVIDER_ICON_BYTES || !isValidPng(bytes)) {
    return null;
  }
  return bytes;
}

export async function syncProviderIcons(
  providers: string[],
  overrides: Partial<ProviderIconSyncDeps> = {}
): Promise<ProviderIconSyncResult> {
  const deps = { ...defaultProviderIconSyncDeps, ...overrides };
  const normalizedProviders = normalizeProviderIconProviders(providers);
  let storedProviders: StoredProviderIconsResult;
  try {
    storedProviders = await deps.listStoredProviders();
  } catch (error) {
    storedProviders = {
      data: null,
      error: {
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }

  if (storedProviders.error || !storedProviders.data) {
    return {
      attempted: 0,
      skipped: 0,
      upserted: 0,
      failedProviders: normalizedProviders,
    };
  }

  const storedProviderMap = new Map(
    storedProviders.data.map((icon) => [icon.provider, icon.updatedAt])
  );
  const refreshCutoff = deps.now() - PROVIDER_ICON_REFRESH_INTERVAL_MS;
  const providersToRefresh = normalizedProviders.filter((provider) => {
    const updatedAt = storedProviderMap.get(provider);
    if (!updatedAt) return true;

    const updatedAtMs = Date.parse(updatedAt);
    return !Number.isFinite(updatedAtMs) || updatedAtMs < refreshCutoff;
  });
  const outcomes: boolean[] = [];

  for (
    let offset = 0;
    offset < providersToRefresh.length;
    offset += PROVIDER_ICON_SYNC_CONCURRENCY
  ) {
    const batch = providersToRefresh.slice(
      offset,
      offset + PROVIDER_ICON_SYNC_CONCURRENCY
    );
    const batchOutcomes = await Promise.all(
      batch.map(async (provider) => {
        const path = getProviderIconPath(provider);
        if (!path) return false;

        const body = await loadProviderLogo(provider, deps.fetchLogo);
        if (!body) return false;

        try {
          const { error } = await deps.uploadLogo(path, body);
          return error === null;
        } catch {
          return false;
        }
      })
    );
    outcomes.push(...batchOutcomes);
  }

  const failedProviders = providersToRefresh.filter(
    (_provider, index) => !outcomes[index]
  );
  return {
    attempted: providersToRefresh.length,
    skipped: normalizedProviders.length - providersToRefresh.length,
    upserted: outcomes.length - failedProviders.length,
    failedProviders,
  };
}
