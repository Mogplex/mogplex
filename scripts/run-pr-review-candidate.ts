import { createGateway } from "ai";
import { DEFAULT_NEW_AGENT_MODEL_ID } from "@/lib/agents/model-options";
import { runPrReviewCandidate } from "@/lib/agents/pr-review-candidate";
import { gatewayProviderOptions } from "@/lib/models/gateway-provider-routing";
import { getAutomationModelFallbackIds } from "@/lib/workflows/automation-model-defaults";

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function main() {
  const apiKey = process.env.AI_GATEWAY_API_KEY?.trim();
  if (!apiKey) throw new Error("AI_GATEWAY_API_KEY is required");
  const modelId =
    process.env.MOGPLEX_QUALITY_MODEL_ID?.trim() || DEFAULT_NEW_AGENT_MODEL_ID;
  const gateway = createGateway({ apiKey });
  process.stdin.setEncoding("utf8");
  let serializedInput = "";
  for await (const chunk of process.stdin) serializedInput += chunk;
  const rawInput = JSON.parse(serializedInput) as unknown;
  const result = await runPrReviewCandidate(rawInput, {
    model: gateway(modelId),
    modelId,
    maxSteps: positiveInteger(process.env.MOGPLEX_QUALITY_MAX_STEPS, 20),
    providerOptions: gatewayProviderOptions(
      modelId,
      {
        userId: "mogplex-quality",
        caching: "auto",
        tags: ["surface:quality", "type:pr_review"],
      },
      getAutomationModelFallbackIds(
        modelId,
        process.env.AUTOMATION_GATEWAY_FALLBACK_MODELS
      )
    ),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

// Node's published-module rule forbids top-level await for executable scripts.
// eslint-disable-next-line unicorn/prefer-top-level-await
void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`mogplex-pr-review-candidate: ${message}\n`);
  process.exitCode = 1;
});
