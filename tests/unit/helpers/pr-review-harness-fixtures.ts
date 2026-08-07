/**
 * Shared fixtures for pr-review-harness tests.
 */

export function makeStep(input: {
  toolCalls?: Array<{ toolName: string; input: unknown }>;
  toolResults?: unknown[];
}) {
  return {
    toolCalls: input.toolCalls ?? [],
    toolResults: input.toolResults ?? [],
  };
}
