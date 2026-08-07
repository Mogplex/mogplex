import { describe, expect, it } from "vitest";
import {
  DEFAULT_DESCRIPTION,
  DEFAULT_TITLE,
  MARKETING_JSON_LD,
  PUBLIC_CONTENT_ROUTES,
  SITE_NAME,
  SOCIAL_IMAGE,
  absoluteUrl,
  buildMarketingMetadata,
} from "./seo";

describe("buildMarketingMetadata", () => {
  it("should propagate site defaults into OG and Twitter cards when no overrides are given", () => {
    const metadata = buildMarketingMetadata({ path: "/pricing" });

    expect(metadata.title).toBe(DEFAULT_TITLE);
    expect(metadata.description).toBe(DEFAULT_DESCRIPTION);
    expect(metadata.openGraph).toMatchObject({
      title: DEFAULT_TITLE,
      description: DEFAULT_DESCRIPTION,
      url: "https://mogplex.com/pricing",
      siteName: SITE_NAME,
      images: [SOCIAL_IMAGE],
    });
    expect(metadata.twitter).toMatchObject({
      title: DEFAULT_TITLE,
      description: DEFAULT_DESCRIPTION,
      images: [SOCIAL_IMAGE],
    });
  });

  it("should keep the canonical path relative while OG URLs are absolute", () => {
    const metadata = buildMarketingMetadata({
      title: "Custom",
      description: "Custom description",
      path: "/faq",
    });

    expect(metadata.alternates?.canonical).toBe("/faq");
    expect(metadata.openGraph?.url).toBe(absoluteUrl("/faq"));
  });

  it("should describe the social image with alt text and OG-standard dimensions", () => {
    expect(SOCIAL_IMAGE.alt).toContain(SITE_NAME);
    expect(SOCIAL_IMAGE.width).toBe(1200);
    expect(SOCIAL_IMAGE.height).toBe(630);
  });
});

describe("PUBLIC_CONTENT_ROUTES", () => {
  it("should list each public path exactly once", () => {
    const paths = PUBLIC_CONTENT_ROUTES.map((route) => route.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toContain("/");
    expect(paths).toContain("/pricing");
  });

  it("should carry hand-set lastModified dates, not build timestamps", () => {
    for (const route of PUBLIC_CONTENT_ROUTES) {
      expect(route.lastModified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(route.lastModified))).toBe(false);
    }
  });

  it("should keep priorities within the sitemap 0..1 range with the homepage highest", () => {
    for (const route of PUBLIC_CONTENT_ROUTES) {
      expect(route.priority).toBeGreaterThan(0);
      expect(route.priority).toBeLessThanOrEqual(1);
    }
    const homepage = PUBLIC_CONTENT_ROUTES.find((route) => route.path === "/");
    expect(homepage?.priority).toBe(1);
  });
});

describe("MARKETING_JSON_LD", () => {
  it("should link the software application node to the organization node", () => {
    const [organization, software] = MARKETING_JSON_LD["@graph"];
    expect(software.creator["@id"]).toBe(organization["@id"]);
    expect(software.description).toBe(DEFAULT_DESCRIPTION);
  });
});
