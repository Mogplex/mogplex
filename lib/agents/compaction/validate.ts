import type {
  AgentCheckpoint,
  CompactableAgentMessage,
  CompactionValidation,
} from "./types";
import { extractMessageText } from "./plan";
import { serializeCoveredTranscript } from "./checkpoint";

/**
 * Compaction is itself an agent action and can introduce errors, so a
 * checkpoint is only accepted after deterministic checks against the material
 * it replaces. A failed validation falls back to plain windowing — a worse
 * context beats a wrong one.
 */

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * The stated original request must trace back to something the user actually
 * said: a normalized substring match in either direction against a covered
 * user message tolerates light paraphrase without allowing invention.
 */
function originalRequestTracesToUser(
  checkpoint: AgentCheckpoint,
  covered: readonly CompactableAgentMessage[]
): boolean {
  const request = normalize(checkpoint.task.originalRequest);
  if (!request) return false;
  for (const message of covered) {
    if (message.role !== "user") continue;
    const text = normalize(extractMessageText(message));
    if (!text) continue;
    if (text.includes(request) || request.includes(text)) return true;
    // Long requests get paraphrased; accept when the majority of the
    // checkpoint's words appear in one user message.
    const words = request.split(" ").filter((word) => word.length > 3);
    if (words.length >= 5) {
      const hits = words.filter((word) => text.includes(word)).length;
      if (hits / words.length >= 0.6) return true;
    }
  }
  return false;
}

export function validateCheckpoint(input: {
  checkpoint: AgentCheckpoint;
  covered: readonly CompactableAgentMessage[];
  previousCheckpoint?: AgentCheckpoint | null;
}): CompactionValidation {
  const { checkpoint, covered, previousCheckpoint } = input;
  const failures: string[] = [];
  const transcript = serializeCoveredTranscript(covered);
  const checkpointJson = normalize(JSON.stringify(checkpoint));

  if (!checkpoint.task.originalRequest.trim()) {
    failures.push("original_request_empty");
  } else if (
    covered.some((message) => message.role === "user") &&
    !originalRequestTracesToUser(checkpoint, covered)
  ) {
    failures.push("original_request_does_not_trace_to_user");
  }

  if (!checkpoint.continuity.nextAction.trim()) {
    failures.push("next_action_empty");
  }

  for (const file of checkpoint.workspace.changedFiles) {
    if (!transcript.includes(file)) {
      failures.push(`changed_file_not_in_transcript:${file}`);
    }
  }

  if (previousCheckpoint) {
    for (const blocker of previousCheckpoint.progress.blockers) {
      // An open blocker may not silently disappear: it either stays open or
      // is mentioned somewhere (resolved, decided, warned about).
      if (!checkpointJson.includes(normalize(blocker))) {
        failures.push(`blocker_dropped:${blocker.slice(0, 80)}`);
      }
    }
  }

  return { ok: failures.length === 0, failures };
}
