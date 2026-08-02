import { AGENT_CATEGORY_SLUG_PATTERN } from "@/lib/agents/category-utils";

export const MAX_AGENT_NAME_LENGTH = 60;
export const MAX_AGENT_DESCRIPTION_LENGTH = 200;
export const MAX_AGENT_SYSTEM_PROMPT_LENGTH = 50_000;

type ValidateAgentInput = {
  name?: unknown;
  description?: unknown;
  category?: unknown;
  systemPrompt?: unknown;
  model?: unknown;
  requireName?: boolean;
  requireModel?: boolean;
  requireCategory?: boolean;
};

export function validateAgentInput({
  name,
  description,
  category,
  systemPrompt,
  model,
  requireName = false,
  requireModel = false,
  requireCategory = false,
}: ValidateAgentInput): string | null {
  if (requireName && (typeof name !== "string" || name.trim().length === 0)) {
    return "Name is required";
  }

  if (typeof name === "string" && name.length > MAX_AGENT_NAME_LENGTH) {
    return `Name must be ${MAX_AGENT_NAME_LENGTH} characters or less`;
  }

  if (
    typeof description === "string" &&
    description.length > MAX_AGENT_DESCRIPTION_LENGTH
  ) {
    return `Description must be ${MAX_AGENT_DESCRIPTION_LENGTH} characters or less`;
  }

  if (
    requireCategory &&
    (typeof category !== "string" || category.trim().length === 0)
  ) {
    return "Category is required";
  }

  // Shape-only check. Ownership/existence of user-defined category slugs is
  // enforced server-side in app/api/agents/route.ts via ensureCategoryAllowed —
  // any new code path that writes to public.agents must call that helper too.
  if (
    category != null &&
    category !== "" &&
    (typeof category !== "string" ||
      !AGENT_CATEGORY_SLUG_PATTERN.test(category))
  ) {
    return "Invalid category";
  }

  if (
    typeof systemPrompt === "string" &&
    systemPrompt.length > MAX_AGENT_SYSTEM_PROMPT_LENGTH
  ) {
    return "System prompt is too long";
  }

  if (
    requireModel &&
    (typeof model !== "string" || model.trim().length === 0)
  ) {
    return "Model is required";
  }

  if (
    model != null &&
    model !== "" &&
    (typeof model !== "string" || model.trim().length === 0)
  ) {
    return "Invalid model";
  }

  return null;
}
