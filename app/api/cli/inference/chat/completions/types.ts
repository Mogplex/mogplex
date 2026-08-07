import type { streamText } from "ai";

export type OpenAiContentPart =
  | { type?: "text"; text?: string }
  | { type?: "image_url"; image_url?: { url?: string } | string };

export type OpenAiMessage = {
  role?: "system" | "user" | "assistant" | "tool";
  content?: string | OpenAiContentPart[] | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id?: string;
    type?: "function";
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
};

export type OpenAiTool = {
  type?: "function";
  function?: {
    name?: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type OpenAiChatRequest = {
  messages?: OpenAiMessage[];
  model?: string | null;
  tools?: OpenAiTool[];
  tool_choice?:
    | "auto"
    | "none"
    | "required"
    | {
        type?: "function";
        function?: { name?: string };
      };
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  stop?: string | string[];
  max_tokens?: number;
  max_completion_tokens?: number;
};

export type TokenUsage =
  | {
      inputTokens?: number | null;
      outputTokens?: number | null;
    }
  | null
  | undefined;

export type UserContentPart =
  | { type: "text"; text: string }
  | { type: "image"; image: string };

export type UserContent = UserContentPart[];

export type AiToolChoice = Parameters<typeof streamText>[0]["toolChoice"];

export type OpenAiUsage = {
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number;
};

export type CliCallOutcome =
  | {
      status: "success";
      usage: CapturedUsageShape;
      toolCalls: Array<{ name: string; input?: unknown }>;
    }
  | { status: "failed"; error: string; usage?: CapturedUsageShape };

export type OpenAiStreamChunk = { type: string; [key: string]: unknown };

/**
 * Shape of CapturedUsage from observability/usage. Kept minimal to avoid
 * circular imports; the actual type is defined in lib/observability/usage.
 */
export type CapturedUsageShape = {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadInputTokens: number | null;
  cacheCreationInputTokens: number | null;
  reasoningTokens: number | null;
  generationId: string | null;
  generationIds: readonly string[];
};
