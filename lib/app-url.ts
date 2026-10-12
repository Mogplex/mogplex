const FALLBACK_REDIRECT_ORIGIN = "https://mogplex.local";

/**
 * Reads an environment variable when the code runs. Next.js replaces a static
 * `process.env.NEXT_PUBLIC_*` member with its build-time value in server
 * bundles too, which would lock a published image to the domain it was built
 * for. A computed key is never inlined.
 */
export function readRuntimeEnv(name: string) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

/**
 * The configured public app URL, read at runtime: `APP_URL` first, then
 * `NEXT_PUBLIC_APP_URL`. Returns `undefined` when neither is set.
 */
export function readAppUrlEnv() {
  return readRuntimeEnv("APP_URL") ?? readRuntimeEnv("NEXT_PUBLIC_APP_URL");
}

function parseHttpUrl(value: string, envName: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${envName} must be a valid absolute URL`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${envName} must use http or https`);
  }

  return url;
}

function getConfiguredAppUrl() {
  const explicitAppUrl = readAppUrlEnv();
  if (explicitAppUrl) {
    return parseHttpUrl(explicitAppUrl, "APP_URL or NEXT_PUBLIC_APP_URL");
  }

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) {
    const normalizedVercelUrl = vercelUrl.includes("://")
      ? vercelUrl
      : `https://${vercelUrl}`;
    return parseHttpUrl(normalizedVercelUrl, "VERCEL_URL");
  }

  return null;
}

export function getCanonicalAppUrl(request?: Request) {
  const configuredUrl = getConfiguredAppUrl();
  if (configuredUrl) {
    return configuredUrl;
  }

  if (request && process.env.NODE_ENV !== "production") {
    return new URL(new URL(request.url).origin);
  }

  throw new Error(
    "APP_URL, NEXT_PUBLIC_APP_URL, or VERCEL_URL must be configured to build app URLs"
  );
}

export function buildAppUrl(path: string, request?: Request) {
  if (!path.startsWith("/")) {
    throw new Error("App URLs must be built from absolute app paths");
  }

  return new URL(path, getCanonicalAppUrl(request));
}

export function normalizeAppRedirectPath(value?: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }

  try {
    const url = new URL(value, FALLBACK_REDIRECT_ORIGIN);
    if (url.origin !== FALLBACK_REDIRECT_ORIGIN) {
      return "/";
    }

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}
