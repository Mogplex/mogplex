import type { ReviewFinding } from "@/lib/types";
import type {
  PrConversationComment,
  PrReviewThread,
  PrReviewThreadComment,
} from "@/lib/github-pr-review-threads";
import type { PrReviewSigner } from "./pr-review-signing";

/** One finding as the summary comment's hidden state records it. */
export type PrReviewStateFinding = Pick<
  ReviewFinding,
  "severity" | "title" | "path" | "line"
> & { key: string; inline: boolean };

export type PrReviewState = {
  sha: string;
  reviewedAt: string;
  findings: PrReviewStateFinding[];
};

/** An earlier finding, with the Mogplex thread that carries it, if any. */
export type PriorFinding = PrReviewStateFinding & {
  id: string;
  thread: {
    id: string;
    url: string | null;
    isResolved: boolean;
    replies: PrReviewThreadComment[];
  } | null;
};

export type PrReviewHistory = {
  reviewedSha: string;
  reviewedAt: string;
  /**
   * incremental: the head moved forward from reviewedSha. same_head: a rerun
   * of the commit already reviewed. full: anything else (rebase, force-push).
   */
  mode: "incremental" | "same_head" | "full";
  changedFiles: string[];
  findings: PriorFinding[];
  conversation: PrConversationComment[];
};

const STATE_PREFIX = "<!-- mogplex-review-state:";
const STATE_PATTERN =
  /<!-- mogplex-review-state:([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+) -->/;
const FINDING_PATTERN =
  /<!-- mogplex-finding:([a-f0-9]{8,64})\.([A-Za-z0-9_-]+) -->/;
const MOGPLEX_MARKER = "<!-- mogplex-";

/**
 * Hidden state for the summary comment; base64url keeps it inside the HTML
 * comment, and the signature keeps anyone else from writing it.
 */
export function serializePrReviewState(
  state: PrReviewState,
  signer: PrReviewSigner
) {
  const encoded = Buffer.from(JSON.stringify(state), "utf8").toString(
    "base64url"
  );
  return `${STATE_PREFIX}${encoded}.${signer.sign(`state:${encoded}`)} -->`;
}

function isStateFinding(value: unknown): value is PrReviewStateFinding {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.key === "string" &&
    typeof entry.title === "string" &&
    ["critical", "warning", "suggestion"].includes(String(entry.severity))
  );
}

export function parsePrReviewState(
  body: string | null,
  signer: PrReviewSigner
): PrReviewState | null {
  const match = body ? STATE_PATTERN.exec(body) : null;
  if (!match || !signer.verify(`state:${match[1]}`, match[2])) return null;
  try {
    const value = JSON.parse(
      Buffer.from(match[1], "base64url").toString("utf8")
    ) as Partial<PrReviewState>;
    if (typeof value.sha !== "string" || typeof value.reviewedAt !== "string")
      return null;
    return {
      sha: value.sha,
      reviewedAt: value.reviewedAt,
      findings: Array.isArray(value.findings)
        ? value.findings.filter(isStateFinding)
        : [],
    };
  } catch {
    return null;
  }
}

/**
 * The newest verified state among the marked comments. Anyone can post a
 * marked comment, even a copy of an earlier signed state from this PR, so
 * the latest review time wins rather than the latest comment.
 */
export function newestPrReviewState(
  bodies: string[],
  signer: PrReviewSigner
): PrReviewState | null {
  let newest: PrReviewState | null = null;
  for (const body of bodies) {
    const state = parsePrReviewState(body, signer);
    if (
      state &&
      (!newest || Date.parse(state.reviewedAt) > Date.parse(newest.reviewedAt))
    ) {
      newest = state;
    }
  }
  return newest;
}

export function findingMarker(key: string, signer: PrReviewSigner) {
  return `<!-- mogplex-finding:${key}.${signer.sign(`finding:${key}`)} -->`;
}

/** The finding key of a Mogplex inline comment; null for anyone else's. */
export function findingKeyOf(
  body: string,
  signer: PrReviewSigner
): string | null {
  const match = FINDING_PATTERN.exec(body);
  if (!match || !signer.verify(`finding:${match[1]}`, match[2])) return null;
  return match[1];
}

/** First line of a Mogplex inline comment without its severity label. */
function threadTitle(body: string) {
  const first = body.replace(FINDING_PATTERN, "").trim().split("\n")[0] ?? "";
  return first.replace(/^\*\*[A-Za-z]+:\*\*\s*/, "").trim();
}

/**
 * Earlier findings: the state's list joined to Mogplex threads by key, plus
 * Mogplex threads the state does not list (an earlier run's finding whose
 * thread was never resolved), so reconciling can close them.
 */
export function collectPriorFindings(
  state: PrReviewState,
  threads: PrReviewThread[],
  signer: PrReviewSigner
): PriorFinding[] {
  const threadsByKey = new Map<string, PrReviewThread>();
  for (const thread of threads) {
    const key = findingKeyOf(thread.comments[0]?.body ?? "", signer);
    if (key && !threadsByKey.has(key)) threadsByKey.set(key, thread);
  }
  const toThread = (thread: PrReviewThread | undefined) =>
    thread
      ? {
          id: thread.id,
          url: thread.url,
          isResolved: thread.isResolved,
          replies: thread.comments
            .slice(1)
            .filter((comment) => !comment.body.includes(MOGPLEX_MARKER)),
        }
      : null;

  const findings: PriorFinding[] = state.findings.map((finding) => ({
    ...finding,
    id: "",
    thread: toThread(threadsByKey.get(finding.key)),
  }));
  const listed = new Set(state.findings.map((finding) => finding.key));
  for (const [key, thread] of threadsByKey) {
    if (listed.has(key)) continue;
    findings.push({
      key,
      severity: "suggestion",
      title: threadTitle(thread.comments[0]?.body ?? ""),
      path: thread.path,
      line: thread.line,
      inline: true,
      id: "",
      thread: toThread(thread),
    });
  }
  return findings.map((finding, index) => ({
    ...finding,
    id: `F${index + 1}`,
  }));
}

export type LoadPrReviewHistoryDeps = {
  signer: PrReviewSigner;
  readSummaryComments: () => Promise<string[]>;
  listThreads: () => Promise<PrReviewThread[]>;
  compare: (
    base: string
  ) => Promise<{ status: string; files: string[]; complete: boolean }>;
  listConversation: (since: string) => Promise<PrConversationComment[]>;
};

/**
 * What the previous review left behind. Null for a first review, including a
 * PR whose summary comment predates the review state, or when the summary
 * comments cannot be read. A later lookup that fails narrows the history
 * (a full review, no replies) instead of dropping it.
 */
export async function loadPrReviewHistory(
  headSha: string,
  deps: LoadPrReviewHistoryDeps
): Promise<PrReviewHistory | null> {
  const state = newestPrReviewState(
    await deps.readSummaryComments().catch(() => [] as string[]),
    deps.signer
  );
  if (!state) return null;

  const [threads, comparison, conversation] = await Promise.all([
    deps.listThreads().catch(() => [] as PrReviewThread[]),
    state.sha === headSha
      ? Promise.resolve(null)
      : deps.compare(state.sha).catch(() => null),
    deps
      .listConversation(state.reviewedAt)
      .catch(() => [] as PrConversationComment[]),
  ]);
  const incremental = comparison?.status === "ahead" && comparison.complete;
  let mode: PrReviewHistory["mode"] = incremental ? "incremental" : "full";
  if (state.sha === headSha) mode = "same_head";
  return {
    reviewedSha: state.sha,
    reviewedAt: state.reviewedAt,
    mode,
    changedFiles: incremental ? comparison.files : [],
    findings: collectPriorFindings(state, threads, deps.signer),
    conversation: conversation.filter(
      (comment) => !comment.isBot && !comment.body.includes(MOGPLEX_MARKER)
    ),
  };
}
