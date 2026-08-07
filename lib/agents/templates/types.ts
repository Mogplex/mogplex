export const AGENT_CATEGORIES = {
  nextjs: { label: "Next.js", slug: "nextjs" },
  performance: { label: "Performance", slug: "performance" },
  api: { label: "API & Backend", slug: "api" },
  security: { label: "Security", slug: "security" },
  data: { label: "Data & Databases", slug: "data" },
  frontend: { label: "Frontend & Design", slug: "frontend" },
  "code-review": { label: "PR Review", slug: "code-review" },
  "code-quality": { label: "Code Quality", slug: "code-quality" },
  seo: { label: "SEO & Marketing", slug: "seo" },
} as const;

export type AgentCategory = keyof typeof AGENT_CATEGORIES;
