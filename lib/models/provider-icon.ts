export const PROVIDER_ICONS_BUCKET = "provider-icons";

const PROVIDER_SLUG_PATTERN = /^[a-z0-9]+(?:[a-z0-9_-]*[a-z0-9])?$/;

export function normalizeProvider(provider: string) {
  return provider.trim().toLowerCase();
}

export function getProviderIconPath(provider: string) {
  const normalizedProvider = normalizeProvider(provider);
  if (!PROVIDER_SLUG_PATTERN.test(normalizedProvider)) return null;
  return `${normalizedProvider}.png`;
}

export function getProviderFromIconPath(path: string) {
  if (!path.endsWith(".png")) return null;
  const provider = path.slice(0, -".png".length);
  return getProviderIconPath(provider) === path ? provider : null;
}

export function normalizeProviderIconProviders(providers: string[]) {
  return [...new Set(providers.map(normalizeProvider))].filter(
    (provider) => getProviderIconPath(provider) !== null
  );
}

export function getProviderIconUrl(provider: string) {
  const path = getProviderIconPath(provider);
  if (!path) return null;

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;

  return `${base.replace(/\/$/, "")}/storage/v1/object/public/${PROVIDER_ICONS_BUCKET}/${path}`;
}

export function getProviderInitial(provider: string) {
  const match = provider.trim().match(/[\p{L}\p{N}]/u);
  return match?.[0]?.toUpperCase() ?? "?";
}
