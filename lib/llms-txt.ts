import { absoluteUrl } from "@/lib/seo";

export const LLMS_TXT_PATH = "/llms.txt";

export function buildLlmsTxt() {
  return `# Mogplex

> Mogplex is the open-source system that builds and maintains software. Agents plan, build, test, and review code in per-run sandboxes. Pull requests come out behind your gates.

Mogplex connects GitHub, MCP tools, Vercel Sandboxes, observability, and pipelines. Teams can start, inspect, and ship agent work through their normal gates.

Authenticated workspace, team, invite, API, and callback URLs are private or operational surfaces. Prefer the links below for public context.

## Public pages

- [Marketing overview](${absoluteUrl("/")}): Product overview for the system that builds and maintains software.
- [Workflow patterns](${absoluteUrl("/workflows")}): Eight pipeline patterns with triggers, gates, and wire commands.
- [How it works](${absoluteUrl("/how-it-works")}): Anatomy of a run — trigger, sandbox, agent loop, gates, and reconciliation.
- [FAQ](${absoluteUrl("/faq")}): Common questions on agents, cost, code execution, gates, and setup.
- [Pricing](${absoluteUrl("/pricing")}): Individual plans by parallel agent runs, Storage, and Inference, plus custom company plans.
- [Company](${absoluteUrl("/company")}): Mogplex Inc. — operating principles, open-source stance, and contact.
- [Sign up](${absoluteUrl("/signup")}): Create an account and confirm an Individual plan.

## Documentation and source

- [Mogplex docs](https://docs.mogplex.com/): Product documentation and usage guides.
- [GitHub repository](https://github.com/mogplex/mogplex): Source, issues, and project activity.

## Policies

- [Privacy policy](${absoluteUrl("/privacy")}): Data collection, storage, OAuth token usage, and third-party services.
- [Terms of service](${absoluteUrl("/terms")}): Service terms, acceptable use, sandbox billing, and warranties.
- [Code of conduct](${absoluteUrl("/conduct")}): Community conduct expectations for project participation.

## Optional

- [Sitemap](${absoluteUrl("/sitemap.xml")}): XML sitemap for public content pages.
- [Robots policy](${absoluteUrl("/robots.txt")}): Crawler policy for public, private, and operational routes.
`;
}
