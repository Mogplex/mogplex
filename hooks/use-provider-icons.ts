"use client";

import useSWR, { type SWRConfiguration } from "swr";
import { ClientFetchError, fetchJsonObject } from "@/lib/client-fetch";
import { normalizeProvider } from "@/lib/models/provider-icon";

type ProviderIconManifest = {
  providers: string[];
};

const providerIconsFetcher = (url: string) =>
  fetchJsonObject<ProviderIconManifest>(url, "Failed to load provider icons");

const EMPTY_PROVIDER_SET = new Set<string>();
const providerSets = new WeakMap<string[], Set<string>>();
const RETRYABLE_PROVIDER_ICON_STATUSES = new Set([
  408, 429, 500, 502, 503, 504,
]);

/** @internal Exported only to verify cross-instance memoization. */
export function getProviderSet(providers: string[] | undefined) {
  if (!providers) return EMPTY_PROVIDER_SET;

  const existing = providerSets.get(providers);
  if (existing) return existing;

  const providerSet = new Set(providers);
  providerSets.set(providers, providerSet);
  return providerSet;
}

export function shouldRetryProviderIconRequest(error: Error) {
  if (error instanceof ClientFetchError) {
    if (error.reason === "invalid_response") return false;
    if (error.status === null) return false;
    return RETRYABLE_PROVIDER_ICON_STATUSES.has(error.status);
  }

  // fetchJsonObject tags HTTP and shape failures; a remaining TypeError comes
  // from fetch itself and represents a transient network failure.
  return error instanceof TypeError;
}

/** @internal Exported so retry wiring can be verified without timers. */
export const PROVIDER_ICON_SWR_OPTIONS = {
  errorRetryCount: 3,
  revalidateOnFocus: false,
  // Retry bounded transient failures, but do not retry auth, other 4xx, or
  // malformed response payloads that cannot recover without a new deploy.
  shouldRetryOnError: shouldRetryProviderIconRequest,
} satisfies SWRConfiguration<ProviderIconManifest, Error>;

export function useProviderIconAvailability(provider: string) {
  const { data, isLoading } = useSWR(
    "/api/models/provider-icons",
    providerIconsFetcher,
    PROVIDER_ICON_SWR_OPTIONS
  );
  const providers = getProviderSet(data?.providers);

  return {
    available: providers.has(normalizeProvider(provider)),
    loading: isLoading,
  };
}
