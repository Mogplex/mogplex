// Sentinel value returned when no specific post-login destination was
// supplied (or the supplied one was unsafe). The auth callback substitutes
// the user's scoped workspace via `defaultLoginNext(slug)` once we know
// their personal slug. A bare "/" also survives validation in
// `normalizeAppRedirectPath` and falls through proxy.ts → `/${slug}` if the
// callback substitution is bypassed for any reason.
export const LOGIN_NEXT_FALLBACK = "/";

const ERROR_CODE = /^[a-z][a-z_]{0,63}$/;
const PARENT_PATH_SEGMENT = /(?:^|\/)\.\.(?:$|\/)/;

function hasControlOrBackslash(value: string) {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return character === "\\" || code <= 31 || code === 127;
  });
}

export function defaultLoginNext(slug: string): string {
  return `/${slug}/projects/workspace`;
}

export function resolveLoginNext(raw: string | null | undefined): string {
  if (!raw) return LOGIN_NEXT_FALLBACK;

  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return LOGIN_NEXT_FALLBACK;
  }

  if (!decoded.startsWith("/") || decoded.startsWith("//")) {
    return LOGIN_NEXT_FALLBACK;
  }
  if (/\s/.test(decoded)) return LOGIN_NEXT_FALLBACK;
  if (hasControlOrBackslash(decoded)) return LOGIN_NEXT_FALLBACK;
  if (PARENT_PATH_SEGMENT.test(decoded)) return LOGIN_NEXT_FALLBACK;

  return raw;
}

export function resolveLoginError(
  raw: string | null | undefined
): string | null {
  return raw && ERROR_CODE.test(raw) ? raw : null;
}

export function buildGithubLoginHref(next: string): string {
  return `/api/auth/login/github?next=${encodeURIComponent(next)}`;
}
