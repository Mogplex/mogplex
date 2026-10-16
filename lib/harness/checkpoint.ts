/**
 * Checkpoint protocol for interactive repo-agent runs. Instead of running
 * straight to a pull request, the agent works to a logical checkpoint (feature
 * implemented, lint/build/typecheck green), starts the dev server as a
 * background service, and emits a checkpoint block naming the preview URL. The
 * harness finalizer detects the block and pauses the run for user feedback
 * rather than opening a PR.
 *
 * The signal is a printed block so it needs no in-sandbox tool:
 *
 *   <<<MOGPLEX_CHECKPOINT>>>
 *   {"previewUrl":"https://…","summary":"…"}
 *   <<<END_MOGPLEX_CHECKPOINT>>>
 */
export const CHECKPOINT_MARKER_START = "<<<MOGPLEX_CHECKPOINT>>>";
export const CHECKPOINT_MARKER_END = "<<<END_MOGPLEX_CHECKPOINT>>>";

export type HarnessCheckpoint = {
  previewUrl: string | null;
  summary: string | null;
  /**
   * `plan`: the agent proposed a plan and changed no files yet. Absent means
   * a review checkpoint (work implemented, waiting for approval to ship).
   */
  kind?: "plan";
};

function normalizePreviewUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

function normalizeSummary(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Agents often put raw line breaks inside the summary string, which strict
 * JSON rejects. Strict parsing runs first, so a pretty-printed body still
 * works; the fallback escapes the raw breaks.
 */
function parseCheckpointBody(body: string): Record<string, unknown> {
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch (error) {
    if (!/[\r\n]/.test(body)) throw error;
    return JSON.parse(body.replace(/\r?\n/g, "\\n")) as Record<string, unknown>;
  }
}

/**
 * Returns the checkpoint the agent declared in its output, or null if none.
 * The last marker wins, so a run that reaches several checkpoints pauses on the
 * most recent. A malformed body still counts as a checkpoint (the agent asked
 * to pause) but with no preview URL or summary.
 */
export function parseHarnessCheckpoint(
  output: string
): HarnessCheckpoint | null {
  const start = output.lastIndexOf(CHECKPOINT_MARKER_START);
  if (start === -1) return null;

  const afterStart = start + CHECKPOINT_MARKER_START.length;
  const end = output.indexOf(CHECKPOINT_MARKER_END, afterStart);
  const body = (
    end === -1 ? output.slice(afterStart) : output.slice(afterStart, end)
  ).trim();

  if (!body) return { previewUrl: null, summary: null };

  try {
    const parsed = parseCheckpointBody(body);
    return {
      previewUrl: normalizePreviewUrl(parsed.previewUrl),
      summary: normalizeSummary(parsed.summary),
      ...(parsed.kind === "plan" ? { kind: "plan" as const } : {}),
    };
  } catch {
    return { previewUrl: null, summary: null };
  }
}

/**
 * Instructions appended to a repo-agent prompt that opt the run into the
 * checkpoint flow. Kept as one block so the harness and any caller share the
 * exact protocol text.
 */
export function buildCheckpointProtocolInstructions(): string {
  return [
    "Checkpoint protocol for this run:",
    "1. Implement the change, then verify it: run lint, build, and typecheck and make them pass.",
    "2. Commit ALL your work and push it to the working branch before pausing. This is REQUIRED: if the user asks for changes, the run continues in a fresh checkout of this branch, so anything left uncommitted is lost. Never pause with uncommitted or unpushed changes.",
    "3. Start the dev server as a BACKGROUND service so it does not block (for example append ` &` or use the platform's background run), capture its preview URL, and do not wait on it.",
    "4. Do NOT open a pull request yet. Instead print exactly this block and then end your turn:",
    CHECKPOINT_MARKER_START,
    '{"previewUrl":"<the dev server URL>","summary":"<one or two sentences on what you did and what to review>"}',
    CHECKPOINT_MARKER_END,
    "5. Wait for the user's feedback. When they approve (for example they say 'ship it'), open the pull request; otherwise apply their guidance and reach the next checkpoint the same way.",
    "Never run a long-lived or interactive command in the foreground; it will stall the run.",
  ].join("\n");
}

/**
 * Instructions that make a run propose a plan and pause before changing any
 * file. The plan arrives as a `plan` checkpoint; approving it resumes the run
 * under the regular checkpoint protocol.
 */
export const PLAN_FIRST_PROTOCOL_HEADING = "Plan-first protocol for this run:";

export function buildPlanFirstProtocolInstructions(): string {
  return [
    PLAN_FIRST_PROTOCOL_HEADING,
    "1. Explore the repository and write a concise implementation plan: the files you will change, the approach, risks or open questions, and how you will verify the result.",
    "2. Do NOT create, edit, or delete files, and do not commit or push, until the user approves the plan.",
    "3. Print exactly this block, with the plan as the summary (short bullet lines, under 1,500 characters, as one-line JSON with line breaks written as \\n), and then end your turn:",
    CHECKPOINT_MARKER_START,
    '{"kind":"plan","previewUrl":null,"summary":"<the plan>"}',
    CHECKPOINT_MARKER_END,
  ].join("\n");
}
