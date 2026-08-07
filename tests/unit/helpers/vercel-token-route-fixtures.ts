const APP_ORIGIN = "http://localhost";

export { APP_ORIGIN };

// Node caches dynamic imports, so every call to loadVercelTokenRoute() returns
// the same module instance. The handlers are exported as factory functions
// (createVercelTokenPostHandler / createVercelTokenDeleteHandler) and each
// test passes its own overrides — never mutate the module's defaultDeps
// directly or you will silently bleed state into every later test in this
// process.
export async function loadVercelTokenRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  process.env.NEXT_PUBLIC_APP_URL ||= APP_ORIGIN;
  return import("../../../app/api/auth/vercel/token/route");
}

export type CsrfOptions = {
  withCsrfHeader?: boolean;
  origin?: string | null;
  referer?: string | null;
};

export function applyCsrfHeaders(
  headers: Record<string, string>,
  { withCsrfHeader = true, origin = APP_ORIGIN, referer }: CsrfOptions
) {
  if (withCsrfHeader) headers["X-Requested-With"] = "XMLHttpRequest";
  if (origin !== null) headers.Origin = origin;
  if (referer) headers.Referer = referer;
}

export function createPostRequest(body: unknown, options: CsrfOptions = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  applyCsrfHeaders(headers, options);
  return new Request(`${APP_ORIGIN}/api/auth/vercel/token`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

export function createDeleteRequest(options: CsrfOptions = {}) {
  const headers: Record<string, string> = {};
  applyCsrfHeaders(headers, options);
  return new Request(`${APP_ORIGIN}/api/auth/vercel/token`, {
    method: "DELETE",
    headers,
  });
}

export function mockResponse(status: number) {
  return new Response(status === 204 ? null : "{}", { status });
}
