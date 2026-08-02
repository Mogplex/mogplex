const DEFAULT_TOKEN_NAME_PREFIX = "CLI on ";
const MAX_TOKEN_NAME_LENGTH = 100;

export type CliAuthSearchParam = string | string[] | undefined;

export function firstOf(value: CliAuthSearchParam): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

export function buildCliAuthReturnUrl(
  params: Record<string, CliAuthSearchParam>
): string {
  const currentParams = new URLSearchParams();

  for (const key of ["callback", "name", "nonce"] as const) {
    const value = firstOf(params[key]);
    if (value) {
      currentParams.set(key, value);
    }
  }

  const query = currentParams.toString();
  return query ? `/cli-auth?${query}` : "/cli-auth";
}

export function resolveCliTokenName(
  rawName: string | null,
  now: Date = new Date()
): string {
  const normalizedName = rawName?.trim().slice(0, MAX_TOKEN_NAME_LENGTH) ?? "";
  if (normalizedName.length > 0) {
    return normalizedName;
  }

  return `${DEFAULT_TOKEN_NAME_PREFIX}${now.toISOString().split("T")[0]}`;
}
