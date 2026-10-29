import {
  normalizeLegacyClientSecret,
  type LegacySecretMethod,
} from "./mcp-client-auth-compatibility";

const LEGACY_ENDPOINTS: Record<string, string> = {
  authorize: "oauth2/authorize",
  token: "oauth2/token",
  register: "oauth2/register",
  userinfo: "oauth2/userinfo",
  jwks: "jwks",
};

/** Cached OAuth clients keep their old URLs; token exchanges gain an audience. */
export async function rewriteLegacyMcpRequest(
  request: Request,
  resource: string,
  loadMethod?: LegacySecretMethod
) {
  const url = new URL(request.url);
  const endpoint = url.pathname.replace(/^\/api\/auth\/mcp\//, "");
  const replacement = LEGACY_ENDPOINTS[endpoint];
  const legacy =
    url.pathname.startsWith("/api/auth/mcp/") && Boolean(replacement);
  const nativeCredentials =
    /^\/api\/auth\/oauth2\/(token|revoke|introspect)$/.test(url.pathname);
  if (!legacy && !nativeCredentials) return request;
  if (legacy) url.pathname = `/api/auth/${replacement}`;
  if (endpoint === "authorize") {
    if (!url.searchParams.has("resource"))
      url.searchParams.set("resource", resource);
    if (!url.searchParams.has("scope"))
      url.searchParams.set("scope", "read write");
  }
  const forwarded = new Request(url, request.clone());
  if ((endpoint !== "token" && !nativeCredentials) || request.method !== "POST")
    return forwarded;
  const contentType = request.headers.get("content-type") ?? "";
  let form: URLSearchParams;
  if (contentType.startsWith("application/x-www-form-urlencoded")) {
    form = new URLSearchParams(await request.clone().text());
  } else if (legacy && contentType.startsWith("application/json")) {
    let data: unknown;
    try {
      data = await request.clone().json();
    } catch {
      return forwarded;
    }
    if (!data || typeof data !== "object" || Array.isArray(data))
      return forwarded;
    const entries = Object.entries(data);
    if (
      !entries.every(
        (entry): entry is [string, string] => typeof entry[1] === "string"
      )
    )
      return forwarded;
    form = new URLSearchParams(entries);
  } else {
    return forwarded;
  }
  if (legacy && !form.has("resource")) form.set("resource", resource);
  const headers = new Headers(forwarded.headers);
  if (loadMethod) await normalizeLegacyClientSecret(form, headers, loadMethod);
  headers.set("content-type", "application/x-www-form-urlencoded");
  headers.delete("content-length");
  return new Request(forwarded, {
    method: "POST",
    headers,
    body: form.toString(),
  });
}

/** Keep discovery stable for clients while forwarding to the native provider. */
export function legacyMcpMetadata(metadata: Record<string, unknown>) {
  const result = { ...metadata };
  for (const field of [
    "authorization_endpoint",
    "token_endpoint",
    "registration_endpoint",
    "userinfo_endpoint",
    "jwks_uri",
  ]) {
    const value = result[field];
    if (typeof value !== "string") continue;
    const url = new URL(value);
    for (const [legacy, native] of Object.entries(LEGACY_ENDPOINTS)) {
      if (url.pathname === `/api/auth/${native}`)
        url.pathname = `/api/auth/mcp/${legacy}`;
    }
    result[field] = url.toString();
  }
  return result;
}
