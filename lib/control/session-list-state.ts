import { ClientFetchError } from "@/lib/client-fetch";

export function resolveSessionListState({
  loaded,
  error,
  count,
}: {
  loaded: boolean;
  error: string | null;
  count: number;
}): "loading" | "error" | "empty" | "ready" {
  // Keep existing rows usable while a refresh is pending or failed.
  if (count > 0) return "ready";
  if (error) return "error";
  if (!loaded) return "loading";
  return count === 0 ? "empty" : "ready";
}

export function controlSelectionFailure(error: unknown) {
  const missing = error instanceof ClientFetchError && error.status === 404;
  return {
    missing,
    message: missing
      ? "That session no longer exists"
      : error instanceof ClientFetchError
        ? error.message
        : "Could not load this chat. Try again.",
  };
}
