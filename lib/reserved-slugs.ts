import { DASHBOARD_SCOPED_FIRST_SEGMENTS } from "@/lib/dashboard-rescue";

// Slugs that cannot be used as personal or team identifiers because the
// URL space collides with an unscoped surface (or one we want to reserve
// for future use).
//
// Keep in sync with public.is_reserved_slug() — post-cutover changes live in
// neon/migrations (latest: 20260804180000_reserve_pricing_slug.sql); the
// initial definition lives in supabase 20260517190000_teams_rbac_phase_0.sql
// (frozen). Note that
// the dashboard-scoped segments merged in below are not yet mirrored in the DB
// function — a follow-up migration should append them so slug claims are
// rejected at the database layer too. Until then this set guards the
// app-side resolver, which is what the proxy consults.
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
