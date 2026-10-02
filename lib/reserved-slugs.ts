import { DASHBOARD_SCOPED_FIRST_SEGMENTS } from "@/lib/dashboard-rescue";

// Slugs that cannot be used as personal or team identifiers because the
// URL space collides with an unscoped surface (or one we want to reserve
// for future use).
//
// Keep in sync with public.is_reserved_slug() in Neon migration
// 20261002021000_reserve_current_routes.sql. Frozen Supabase history is unchanged.
const RESERVED = new Set<string>([
  // existing top-level routes
  "api",
  "auth",
  "cli-auth",
  "checkout",
  "company",
  "conduct",
  "faq",
  "forgot-password",
  "how-it-works",
  "install",
  "install.sh",
  "install.ps1",
  "login",
  "oauth",
  "pricing",
  "privacy",
  "request-access",
  "reset-password",
  "signup",
  "slack",
  "storage",
  "terms",
  "unsubscribe",
  "workflows",
  // future reservations
  "new",
  "invite",
  "account",
  "admin",
  "support",
  "status",
  // infra / static
  ".well-known",
  "favicon.ico",
  "robots.txt",
  "sitemap.xml",
  "llms.txt",
  "opengraph-image",
  "apple-icon",
  "icon",
  "manifest.webmanifest",
  "global-error",
  "not-found",
  "error",
  // dashboard-scoped first segments — folded in so a new section added to
  // `DASHBOARD_SCOPED_FIRST_SEGMENTS` automatically becomes reserved.
  ...DASHBOARD_SCOPED_FIRST_SEGMENTS,
]);

export const RESERVED_SLUGS: ReadonlySet<string> = RESERVED;

export function isReservedSlug(slug: string): boolean {
  return RESERVED.has(slug.toLowerCase());
}
