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
  /<!-- mogplex-review-state:([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+) -->/g;
const FINDING_PATTERN =
  /<!-- mogplex-finding:([a-f0-9]{8,64})\.([A-Za-z0-9_-]+) -->/g;
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
    ["critical", "warning", "suggestion"].includes(String(entry.severity)) &&
    (entry.path === null || typeof entry.path === "string") &&
    (entry.line === null || typeof entry.line === "number") &&
    typeof entry.inline === "boolean"
  );
}

/**
 * The first marker in `body` whose signature verifies. Marker-shaped text
 * can appear earlier (a finding quoting one), so a non-verifying match is
 * skipped rather than ending the search.
 */
function firstVerified(
  body: string,
  pattern: RegExp,
  verify: (value: string, signature: string) => boolean
) {
  for (const match of body.matchAll(pattern)) {
    if (verify(match[1], match[2])) return match[1];
  }
  return null;
}

export function parsePrReviewState(
  body: string | null,
  signer: PrReviewSigner
): PrReviewState | null {
  const encoded = body
    ? firstVerified(body, STATE_PATTERN, (value, signature) =>
        signer.verify(`state:${value}`, signature)
      )
    : null;
  if (!encoded) return null;
  try {
    const value = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8")
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

/** A comment carrying the summary marker, as GitHub returned it. */
export type PrReviewSummaryComment = { body: string; author: string | null };

/**
 * The newest verified state among the marked comments, with the author of
 * the comment that holds it. Anyone can post a marked comment, even a copy
 * of an earlier signed state from this PR, so the latest review time wins
 * rather than the latest comment.
 */
export function newestPrReviewState(
  comments: PrReviewSummaryComment[],
  signer: PrReviewSigner
): { state: PrReviewState; author: string | null } | null {
  let newest: { state: PrReviewState; author: string | null } | null = null;
  for (const comment of comments) {
    const state = parsePrReviewState(comment.body, signer);
    if (
      state &&
      (!newest ||
        Date.parse(state.reviewedAt) > Date.parse(newest.state.reviewedAt))
    ) {
      newest = { state, author: comment.author };
    }
  }
  return newest;
}

/** GitHub names an App "x[bot]" over REST and "x" over GraphQL. */
function sameAccount(a: string | null | undefined, b: string | null) {
  const login = (value: string | null | undefined) =>
    (value ?? "")
      .trim()
      .toLowerCase()
      .replace(/\[bot\]$/, "");
  return login(a) !== "" && login(a) === login(b);
}

export function findingMarker(key: string, signer: PrReviewSigner) {
  return `<!-- mogplex-finding:${key}.${signer.sign(`finding:${key}`)} -->`;
}

/** The finding key of a Mogplex inline comment; null for anyone else's. */
export function findingKeyOf(
  body: string,
  signer: PrReviewSigner
): string | null {
  return firstVerified(body, FINDING_PATTERN, (value, signature) =>
    signer.verify(`finding:${value}`, signature)
  );
}

const SEVERITY_LABEL = /^\*\*(Critical|Warning|Suggestion):\*\*\s*/i;

function firstLine(body: string) {
  return body.replace(FINDING_PATTERN, "").trim().split("\n")[0] ?? "";
}

/** First line of a Mogplex inline comment without its severity label. */
function threadTitle(body: string) {
  return firstLine(body)
    .replace(/^\*\*[A-Za-z]+:\*\*\s*/, "")
    .trim();
}

/** The severity label an inline comment opens with. */
function threadSeverity(body: string): PrReviewStateFinding["severity"] {
  const label = SEVERITY_LABEL.exec(firstLine(body))?.[1]?.toLowerCase();
  return label === "critical" || label === "warning" ? label : "suggestion";
}

/**
 * Earlier findings: the state's list joined to Mogplex threads by key, plus
 * Mogplex threads the state does not list (an earlier run's finding whose
 * thread was never resolved), so reconciling can close them.
 */
export function collectPriorFindings(
  state: PrReviewState,
  threads: PrReviewThread[],
  signer: PrReviewSigner,
  /** Who wrote the summary comment; only their threads are Mogplex's. */
  owner: string | null
): PriorFinding[] {
  const threadsByKey = new Map<string, PrReviewThread>();
  for (const thread of threads) {
    const root = thread.comments[0];
    // A signed marker can be copied into anyone's comment; the account
    // that posts the reviews is what makes a thread ours.
    if (!root || !sameAccount(root.author, owner)) continue;
    const key = findingKeyOf(root.body, signer);
    if (!key) continue;
    // A key can own two threads: one a person resolved, and a newer one
    // posted when the finding came back. The open one is the live thread.
    const known = threadsByKey.get(key);
    if (!known || (known.isResolved && !thread.isResolved)) {
      threadsByKey.set(key, thread);
    }
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
      severity: threadSeverity(thread.comments[0]?.body ?? ""),
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
  readSummaryComments: () => Promise<PrReviewSummaryComment[]>;
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
  const latest = newestPrReviewState(
    await deps.readSummaryComments().catch((error: unknown) => {
      console.warn("[pr-review] history lookup failed", {
        lookup: "summary",
        error: error instanceof Error ? error.message : String(error),
      });
      return [] as PrReviewSummaryComment[];
    }),
    deps.signer
  );
  if (!latest) return null;
  const { state } = latest;

  // Each lookup that fails narrows the history; say so, or review memory
  // could degrade with no signal.
  const warn = (lookup: string) => (error: unknown) => {
    console.warn("[pr-review] history lookup failed", {
      lookup,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  };
  const [threads, comparison, conversation] = await Promise.all([
    deps.listThreads().catch(warn("threads")),
    state.sha === headSha
      ? Promise.resolve(null)
      : deps.compare(state.sha).catch(warn("compare")),
    deps.listConversation(state.reviewedAt).catch(warn("conversation")),
  ]);
  const incremental = comparison?.status === "ahead" && comparison.complete;
  let mode: PrReviewHistory["mode"] = incremental ? "incremental" : "full";
  if (state.sha === headSha) mode = "same_head";
  return {
    reviewedSha: state.sha,
    reviewedAt: state.reviewedAt,
    mode,
    changedFiles: incremental ? comparison.files : [],
    findings: collectPriorFindings(
      state,
      threads ?? [],
      deps.signer,
      latest.author
    ),
    conversation: (conversation ?? []).filter(
      (comment) => !comment.isBot && !comment.body.includes(MOGPLEX_MARKER)
    ),
  };
}
