import { getCanonicalAppUrl } from "@/lib/app-url";

/**
 * The public origin GitHub should call back. Uses the configured app URL, and
 * outside production falls back to the request's host so local setup works
 * without `NEXT_PUBLIC_APP_URL`. Returns null when neither is available.
 */
export function resolveSetupOrigin(
  headers: Pick<Headers, "get">
): string | null {
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  const proto =
    headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "http";
  try {
    const request = host ? new Request(`${proto}://${host}/`) : undefined;
    return getCanonicalAppUrl(request).origin;
  } catch {
    return null;
  }
}
