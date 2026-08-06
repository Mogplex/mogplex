import type { Metadata, MetadataRoute } from "next";

export const SITE_URL = "https://mogplex.com";
export const SITE_NAME = "Mogplex";
export const DEFAULT_TITLE =
  "Mogplex | The open-source engine for building and maintaining software";
export const DEFAULT_DESCRIPTION =
  "Mogplex runs agents that plan, build, test, and review code in per-run sandboxes. Pull requests come out behind your gates.";
export const SOCIAL_IMAGE = {
  url: "/opengraph-image.png",
  width: 1200,
  height: 630,
  alt: "Mogplex open-source software engine and inspectable agent run",
} as const;

type PublicContentRoute = {
  path: `/${string}`;
  lastModified: string;
  changeFrequency: NonNullable<
    MetadataRoute.Sitemap[number]["changeFrequency"]
  >;
  priority: number;
};

// Keep lastModified aligned with meaningful content edits for each public page.
// It is intentionally not a build timestamp.
export const PUBLIC_CONTENT_ROUTES = [
  {
    path: "/",
    lastModified: "2026-08-05",
    changeFrequency: "weekly",
    priority: 1,
  },
  {
    path: "/workflows",
    lastModified: "2026-08-05",
    changeFrequency: "monthly",
    priority: 0.9,
  },
  {
    path: "/how-it-works",
    lastModified: "2026-08-05",
    changeFrequency: "monthly",
    priority: 0.8,
  },
  {
    path: "/faq",
    lastModified: "2026-08-05",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    path: "/pricing",
    lastModified: "2026-08-05",
    changeFrequency: "monthly",
    priority: 0.9,
  },
  {
    path: "/company",
    lastModified: "2026-08-05",
    changeFrequency: "monthly",
    priority: 0.6,
  },
  {
    path: "/privacy",
    lastModified: "2026-03-15",
    changeFrequency: "yearly",
    priority: 0.3,
  },
  {
    path: "/terms",
    lastModified: "2026-03-15",
    changeFrequency: "yearly",
    priority: 0.3,
  },
  {
    path: "/conduct",
    lastModified: "2026-03-15",
    changeFrequency: "yearly",
    priority: 0.3,
  },
] as const satisfies readonly PublicContentRoute[];

export const NO_INDEX_ROBOTS = {
  index: false,
  follow: true,
} satisfies Metadata["robots"];

export const PRIVATE_NO_INDEX_ROBOTS = {
  index: false,
  follow: false,
} satisfies Metadata["robots"];

export function absoluteUrl(path: `/${string}`) {
  return new URL(path, SITE_URL).toString();
}

export function buildMarketingMetadata({
  title = DEFAULT_TITLE,
  description = DEFAULT_DESCRIPTION,
  path,
}: {
  title?: string;
  description?: string;
  path: `/${string}`;
}): Metadata {
  return {
    title,
    description,
    alternates: {
      canonical: path,
    },
    openGraph: {
      title,
      description,
      url: absoluteUrl(path),
      siteName: SITE_NAME,
      type: "website",
      images: [SOCIAL_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [SOCIAL_IMAGE],
    },
  };
}

export const MARKETING_JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: SITE_NAME,
      url: SITE_URL,
      logo: absoluteUrl("/icon.png"),
      sameAs: ["https://github.com/mogplex/mogplex"],
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${SITE_URL}/#software`,
      name: SITE_NAME,
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web",
      url: SITE_URL,
      description: DEFAULT_DESCRIPTION,
      creator: {
        "@id": `${SITE_URL}/#organization`,
      },
    },
  ],
} as const;
