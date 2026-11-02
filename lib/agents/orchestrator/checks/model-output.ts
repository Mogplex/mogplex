import { redactSecretsInText } from "@/lib/ai-telemetry";
import { controlToolFailureDetail } from "@/lib/control/tool-outcome";
import { repositoryCheckReceiptSchema } from "./receipt";

/** Keep full operator receipts, but send the model statuses and failure tails. */
export function repositoryChecksModelOutput({ output }: { output: unknown }) {
  const parsed = repositoryCheckReceiptSchema.safeParse(output);
  if (!parsed.success) {
    const record =
      output && typeof output === "object"
        ? (output as Record<string, unknown>)
        : {};
    const message =
      typeof record.summary === "string"
        ? record.summary
        : controlToolFailureDetail(record);
    return {
      type: "text" as const,
      value: redactSecretsInText(message).slice(0, 2000),
    };
  }
  const receipt = parsed.data;
  return {
    type: "json" as const,
    value: {
      ...receipt,
      ...(receipt.error
        ? { error: redactSecretsInText(receipt.error).slice(0, 500) }
        : {}),
      checks: receipt.checks.map(
        ({ kind, command, status, exitCode, reason, stdout, stderr }) => ({
          kind,
          command,
          status,
          exitCode,
          ...(reason
            ? { reason: redactSecretsInText(reason).slice(0, 500) }
            : {}),
          ...(status === "failed" || status === "blocked"
            ? {
                outputTail: redactSecretsInText(
                  [stdout, stderr].filter(Boolean).join("\n")
                ).slice(-1500),
              }
            : {}),
        })
      ),
    },
  };
}
