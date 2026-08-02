import type { MetadataRoute } from "next";
import { DASHBOARD_SCOPED_FIRST_SEGMENTS } from "@/lib/dashboard-rescue";
import { PUBLIC_CONTENT_ROUTES, absoluteUrl } from "@/lib/seo";

const STATIC_ASSET_ALLOWLIST = [
  "/favicon.ico",
  "/icon.png",
  "/apple-icon.png",
  "/opengraph-image.png",
  "/llms.txt",
] as const;

const APP_ROUTE_DISALLOWLIST = [
  "/api/",
  "/auth/",
  "/login",
  "/invite/",
  "/cli-auth",
  "/new/",
  "/slack/",
  "/unsubscribe",
  "/install.sh",
  "/install.ps1",
] as const;

function dashboardRouteDisallowlist() {
  return Array.from(DASHBOARD_SCOPED_FIRST_SEGMENTS)
    .sort()
    .flatMap((segment) => [`/${segment}`, `/*/${segment}`]);
}

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: [
        ...PUBLIC_CONTENT_ROUTES.map((route) => route.path),
        ...STATIC_ASSET_ALLOWLIST,
      ],
      disallow: [...APP_ROUTE_DISALLOWLIST, ...dashboardRouteDisallowlist()],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
