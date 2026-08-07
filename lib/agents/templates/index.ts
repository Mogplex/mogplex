/**
 * Preconfigured agent templates catalog.
 *
 * Templates are organized by category in sibling modules and composed here.
 * @see ./types.ts for AGENT_CATEGORIES and AgentCategory
 */

import { NEXTJS_AGENTS } from "./nextjs";
import { PERFORMANCE_AGENTS } from "./performance";
import { API_AGENTS } from "./api";
import { SECURITY_AGENTS } from "./security";
import { DATA_AGENTS } from "./data";
import { FRONTEND_AGENTS } from "./frontend";
import { CODE_REVIEW_AGENTS } from "./code-review";
import { CODE_QUALITY_AGENTS } from "./code-quality";
import { SEO_AGENTS } from "./seo";

export { AGENT_CATEGORIES, type AgentCategory } from "./types";

export const PRECONFIGURED_AGENTS = [
  ...NEXTJS_AGENTS,
  ...PERFORMANCE_AGENTS,
  ...API_AGENTS,
  ...SECURITY_AGENTS,
  ...DATA_AGENTS,
  ...FRONTEND_AGENTS,
  ...CODE_REVIEW_AGENTS,
  ...CODE_QUALITY_AGENTS,
  ...SEO_AGENTS,
] as const;

export type PreconfiguredAgentName =
  (typeof PRECONFIGURED_AGENTS)[number]["name"];
