import { MOGPLEX_PR_REVIEW_TIMELINE_MARKER } from "@/lib/github-check-runs";

/**
 * Hidden HTML marker appended to every GitHub comment Mogplex posts on a user's
 * behalf. Agent comments are posted with the connected user's token, so they
 * arrive on the `issue_comment` / `pull_request_review_comment` webhooks as a
 * regular `User` (e.g. the repo owner), not as `mogplex[bot]`. The existing
 * `type === "Bot"` guard therefore cannot recognize them, and any "@mogplex"
 * the model writes in its reply re-triggers the mention flow — a self-loop.
 *
 * Stamping outbound comments lets the webhook recognize our own output by
 * content instead of by author, so we can skip it without also suppressing a
 * human who genuinely types "@mogplex".
 */
export const MOGPLEX_AUTOMATION_COMMENT_MARKER = "<!-- mogplex:automated -->";

export function withAutomationMarker(body: string): string {
  if (body.includes(MOGPLEX_AUTOMATION_COMMENT_MARKER)) return body;
  return `${body.trimEnd()}\n\n${MOGPLEX_AUTOMATION_COMMENT_MARKER}`;
}

/**
 * True when a comment body was authored by Mogplex automation — either a
 * marked agent comment or the PR-review timeline comment (which carries its
 * own pre-existing marker). Used by the webhook to break self-mention loops.
 */
export function isMogplexAuthoredComment(
  body: string | null | undefined
): boolean {
  if (!body) return false;
  return (
    body.includes(MOGPLEX_AUTOMATION_COMMENT_MARKER) ||
    body.includes(MOGPLEX_PR_REVIEW_TIMELINE_MARKER)
  );
}
