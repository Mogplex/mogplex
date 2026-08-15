import { headers } from "next/headers";

export const SCOPE_LAYOUT_MISSING_HEADERS_ERROR =
  "ScopeLayout: x-mogplex-scope-* headers missing for scoped route";

export type ScopeContext =
  | { kind: "personal"; slug: string; profileId: string }
  | { kind: "team"; slug: string; teamId: string };

type ScopeHeaders = {
  get: (name: string) => string | null;
};

export const IMAGE_ASSET_SCOPE_EXTENSIONS = [
  "svg",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
] as const;

const IMAGE_ASSET_SCOPE_SEGMENT_RE = new RegExp(
  `\\.(?:${IMAGE_ASSET_SCOPE_EXTENSIONS.join("|")})$`,
  "i"
);

export function isImageAssetScopeSegment(scopeSegment: string): boolean {
  return IMAGE_ASSET_SCOPE_SEGMENT_RE.test(scopeSegment);
}

export function parseScopeContextHeaders(h: ScopeHeaders): ScopeContext | null {
  const kind = h.get("x-mogplex-scope-kind");
  const slug = h.get("x-mogplex-scope-slug");
  const id = h.get("x-mogplex-scope-id");

  if (!kind || !slug || !id) return null;
  if (kind === "personal") return { kind, slug, profileId: id };
  if (kind === "team") return { kind, slug, teamId: id };
  throw new Error(`parseScopeContextHeaders: unknown scope kind "${kind}"`);
}

// Server-only. Reads the x-mogplex-scope-* headers set by proxy.ts.
// Throws if called from a route the middleware doesn't run on — that
// means the route is misconfigured and we want a loud failure, not a
// silent null that downstream code papers over.
export async function getScopeContext(): Promise<ScopeContext> {
  const scope = parseScopeContextHeaders(await headers());

  if (!scope) {
    throw new Error(
      "getScopeContext: x-mogplex-scope-* headers missing — middleware did not run for this route"
    );
  }

  return scope;
}
