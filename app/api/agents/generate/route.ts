import { streamText } from "ai";
import { requireUserId } from "@/lib/auth";
import { resolveUserLanguageModel } from "@/lib/ai-model-resolver";
import {
  canUserSetDefaultModel,
  resolveUserDefaultModelId,
} from "@/lib/models/default-model";
import { recordAiCallTelemetry } from "@/lib/observability/ai-call-telemetry";
import { captureUsage } from "@/lib/observability/usage";
import {
  ALLOWLIST_UNAVAILABLE_RETRY_AFTER_SECONDS,
  isModelAllowlistUnavailableError,
  readActiveTeamIdHeader,
} from "@/lib/team-capabilities";
import { AGENT_CATEGORIES } from "@/lib/agents/templates";
import type { AgentCategory } from "@/lib/agents/templates";
import type { LanguageModelUsage } from "ai";

const CATEGORIES = Object.keys(AGENT_CATEGORIES) as AgentCategory[];
const VALID_CATEGORIES = new Set(CATEGORIES);
const MAX_CONTEXT_TEXT_LENGTH = 200;
const MAX_CONTEXT_SECTIONS = 6;

const SYSTEM_PROMPT = `You are an expert AI agent architect for Mogplex, a terminal multiplexer for AI agents.

When the user describes an agent they want, generate a complete agent configuration as a single JSON object. Output ONLY the JSON — no markdown fences, no explanation.

The JSON must have these fields:
- "name": SHORT uppercase slug, e.g. "NEXTJS-REVIEWER", "BUNDLE-SIZE", "API-DESIGN" (max 30 chars, use hyphens)
- "description": One-line summary (max 80 chars)
- "category": One of: ${CATEGORIES.join(", ")}
- "system_prompt": A detailed markdown system prompt (200-600 words) that defines the agent's role, review focus areas, patterns to flag, and output format. Use ## headings and bullet lists. Be specific and actionable — not generic.

Guidelines for the system_prompt:
- Start with "You are a [role] specialized in [domain]."
- Include a ## REVIEW FOCUS section with 5-8 bullet points
- Include a ## PATTERNS TO FLAG section with specific anti-patterns
- Include a ## OUTPUT FORMAT section defining how to report findings
- Be opinionated — the best agents have strong viewpoints
- Reference specific technologies, APIs, or patterns relevant to the domain
- If the agent is for a specific framework, include version-specific advice
- If the user includes an existing agent, revise that draft instead of inventing an unrelated one`;

type ExistingAgentInput = {
  name?: unknown;
  description?: unknown;
  category?: unknown;
  system_prompt?: unknown;
} | null;

type SanitizedExistingAgentContext = {
  name?: string;
  description?: string;
  category?: AgentCategory;
  system_prompt_sections?: string[];
};

type GenerateAgentPostDeps = {
  requireUserId: typeof requireUserId;
  resolveUserDefaultModelId: typeof resolveUserDefaultModelId;
  canUserSetDefaultModel: typeof canUserSetDefaultModel;
  resolveUserLanguageModel: typeof resolveUserLanguageModel;
  streamText: typeof streamText;
};

const defaultGenerateAgentPostDeps: GenerateAgentPostDeps = {
  requireUserId,
  resolveUserDefaultModelId,
  canUserSetDefaultModel,
  resolveUserLanguageModel,
  streamText,
};

function normalizeContextText(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.slice(0, MAX_CONTEXT_TEXT_LENGTH);
}

function extractPromptSections(value: unknown) {
  if (typeof value !== "string") return [];

  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("## "))
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
    .slice(0, MAX_CONTEXT_SECTIONS);
}

export function sanitizeExistingAgentForPrompt(
  existingAgent?: ExistingAgentInput
): SanitizedExistingAgentContext | null {
  if (!existingAgent) return null;

  const name = normalizeContextText(existingAgent.name);
  const description = normalizeContextText(existingAgent.description);
  const category =
    typeof existingAgent.category === "string" &&
    VALID_CATEGORIES.has(existingAgent.category as AgentCategory)
      ? (existingAgent.category as AgentCategory)
      : undefined;
  const systemPromptSections = extractPromptSections(
    existingAgent.system_prompt
  );

  if (!name && !description && !category && systemPromptSections.length === 0) {
    return null;
  }

  return {
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
    ...(category ? { category } : {}),
    ...(systemPromptSections.length > 0
      ? { system_prompt_sections: systemPromptSections }
      : {}),
  };
}

function buildGenerationPrompt(
  description: string,
  existingAgent?: ExistingAgentInput
) {
  const sanitizedExistingAgent = sanitizeExistingAgentForPrompt(existingAgent);
  if (!sanitizedExistingAgent) return description;

  return [
    "Update the existing agent configuration to satisfy the requested changes.",
    "Return the full updated JSON object with name, description, category, and system_prompt.",
    `Existing agent context:\n${JSON.stringify(
      sanitizedExistingAgent,
      null,
      2
    )}`,
    `Requested changes:\n${description}`,
  ].join("\n\n");
}

export function createAgentGeneratePostHandler(
  overrides: Partial<GenerateAgentPostDeps> = {}
) {
  const deps: GenerateAgentPostDeps = {
    ...defaultGenerateAgentPostDeps,
    ...overrides,
  };

  return async function POST(req: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const body = (await req.json()) as Record<string, unknown>;
    const description =
      typeof body.description === "string" ? body.description : "";
    const generatorModel =
      typeof body.generatorModel === "string" ? body.generatorModel.trim() : "";
    const existingAgent =
      typeof body.existingAgent === "object" && body.existingAgent !== null
        ? (body.existingAgent as ExistingAgentInput)
        : null;

    if (!description) {
      return Response.json(
        { error: "description is required" },
        { status: 400 }
      );
    }
    if (description.length > 2000) {
      return Response.json(
        { error: "Description too long (max 2000)" },
        { status: 400 }
      );
    }

    if (generatorModel) {
      const canUseGeneratorModel = await deps.canUserSetDefaultModel(
        userId,
        generatorModel
      );
      if (!canUseGeneratorModel) {
        return Response.json(
          { error: "generatorModel must be enabled and available" },
          { status: 400 }
        );
      }
    }

    const modelId =
      generatorModel || (await deps.resolveUserDefaultModelId(userId, null));

    let resolved;
    try {
      resolved = await deps.resolveUserLanguageModel(userId, modelId, {
        gatewayContext: {
          userId,
          tags: ["surface:agent_generator"],
        },
        teamId: readActiveTeamIdHeader(req),
      });
    } catch (err) {
      return Response.json(
        {
          error: err instanceof Error ? err.message : "Model resolution failed",
        },
        // 403 is the right default here (capability denied, not on the
        // allowlist), but an unreadable allowlist is transient — a permanent
        // status would tell the client not to retry a call whose own copy says
        // to try again.
        isModelAllowlistUnavailableError(err)
          ? {
              status: 503,
              headers: {
                "Retry-After": String(
                  ALLOWLIST_UNAVAILABLE_RETRY_AFTER_SECONDS
                ),
              },
            }
          : { status: 403 }
      );
    }

    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    const result = deps.streamText({
      model: resolved.model,
      providerOptions: resolved.providerOptions,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: buildGenerationPrompt(description, existingAgent),
        },
      ],
      async onFinish({ totalUsage, providerMetadata, finishReason }) {
        await recordAiCallTelemetry({
          userId,
          type: "agent",
          model: modelId,
          usage: captureUsage(
            totalUsage as LanguageModelUsage | undefined,
            providerMetadata
          ),
          startedAtMs,
          startedAt,
          status: finishReason === "error" ? "failed" : "success",
          error:
            finishReason === "error" ? "Agent generator stream failed" : null,
          metadata: {
            surface: "agent_generator",
            finish_reason: finishReason,
          },
          logPrefix: "[agent-generate]",
        });
      },
    });

    return result.toTextStreamResponse();
  };
}

export const POST = createAgentGeneratePostHandler();
