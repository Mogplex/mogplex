# PR review lifecycle: memory across runs

Every push to a pull request starts a new review. Without memory, each run
reviews the whole PR from scratch: it re-raises findings the author already
answered, files new suggestions on code nobody touched, and leaves its old
threads open after the code is fixed. Reviews never converge. This design
gives the reviewer three things, all kept on GitHub (no schema change):

1. **Finding lifecycle.** Each finding has a stable key across runs. A
   finding that is reported again keeps its thread; one that is no longer
   reported gets a reply and its thread is resolved.
2. **Replies are input.** The author's thread replies and PR comments since
   the last review go into the next review's prompt. A finding the author
   answered is not reported again unless the code changed or the reviewer
   answers the reason.
3. **Incremental re-review.** When the PR head moved forward from the last
   reviewed commit, the reviewer checks earlier findings and reviews only
   what changed since then for new ones.

## State

- **Finding key.** A short hash of the finding's path, title and body when
  it is first reported. The inline comment carries it as
  `<!-- mogplex-finding:KEY.SIG -->`.
- **Review state.** The summary comment ends with
  `<!-- mogplex-review-state:BASE64URL.SIG -->`: the reviewed head SHA, the
  review time, and every finding with its key, severity, title, path, line,
  and whether it was posted inline. The encoded state stays under 16,000
  characters (titles are cut at 200), so it fits in the comment beside the
  review. Past that, the oldest carried findings are dropped; one that has a
  thread is found again through its thread's marker.
- **Threads.** Read through GraphQL `pullRequest.reviewThreads`, with each
  thread's first comment and its latest twenty. A thread is Mogplex's when
  its first comment carries a finding marker that verifies. Replies are its
  other comments that carry no Mogplex marker.

### Signed markers

Anyone who can comment on the PR can write a marker, and reviews may post
with the connected user's token, so the comment author does not identify
Mogplex. Without a check, a forged state comment could claim the PR was
already reviewed at a commit of the author's choosing and narrow the next
review to a few files.

`lib/workflows/pr-review-signing.ts` signs every marker with an HMAC bound
to the repository and PR number. The key is derived (HKDF, labelled for
this purpose) from `GITHUB_APP_PRIVATE_KEY`, which every deployment that
reviews PRs already has, so there is no new secret to provision. A marker
that does not verify is read as absent: forged state, or state copied from
another PR, means a first review, and a forged finding marker makes a
thread someone else's. A copy within the same PR still verifies, so the
reader looks at every comment carrying the summary marker and takes the
verified state with the newest review time; an old copy cannot stand in for
the latest review. Within a comment the reader skips marker-shaped text that
does not verify and takes the first marker that does, so text quoted ahead
of the real marker cannot hide it. A signed finding marker can also be
copied into another person's comment, so a thread counts as Mogplex's only
when its first comment comes from the account that posted the summary
holding the verified state (`x[bot]` over REST and `x` over GraphQL are the
same account). Without the key, the lifecycle stays off and every
review is a first review. Rotating the App private key resets review
memory the same way: existing markers stop verifying, and the next review
on each PR may post its findings inline again.

The summary upsert edits the newest comment carrying the marker. If that
comment is someone else's (GitHub answers 403 or 404 to the edit), it posts
a new summary comment instead.

A PR reviewed before this shipped has no state, so its next review is a
first review.

## Before the run: history

`loadPrReviewHistory` (`lib/workflows/pr-review-history.ts`) reads the
summary comment's state, the Mogplex threads, the author's PR comments
since the last review, and `compare/{reviewedSha}...{head}`:

- `ahead`, with the full file list: incremental. The prompt lists the files
  changed since the last review.
- The same commit (a rerun): a full review, described as a rerun.
- Anything else (force-push, rebase, more than 300 changed files, lookup
  failed): a full review. Both full modes still get the earlier findings
  and replies.

`buildPrReviewHistoryBlock` turns this into a `<previous_review>` block in
the review prompt, for native and harness reviewers alike. Author text in it is
bounded: the latest five replies per finding, the latest twenty PR
comments, and the first 2,000 characters of each, with a line saying how
many were left out. When the whole block passes 30,000 characters, quotes
are cut to 600 and then 200 characters, so the author's text cannot grow
every later review prompt without bound. Earlier findings
get short ids (`F1`, `F2`, ...) with their thread state and the author's
replies. The rules it states:

- Report an earlier finding again only if it still applies at the current
  head, with `priorId` set to its id.
- If the author replied, weigh the reply against the code. Leave the finding
  out only if the reply shows it does not apply; otherwise report it again
  and answer the reply in the finding body.
- If a person resolved its thread, report it again only if the code it is
  about changed or there is new evidence.
- In an incremental review, report new findings only on code that changed
  since the last review, unless they are critical.

The report schema adds an optional `priorId` to each finding (`reportReview`
and the harness JSON line).

## After the run: reconcile

`planPrReviewThreads` (`lib/workflows/pr-review-lifecycle.ts`) is pure:

- A finding with a `priorId` in the same file keeps that finding's key. A
  finding reported again without its `priorId`, in the same file with the
  same title, keeps it too. Others get a new key.
- A finding whose key has an open Mogplex thread is not posted again; the
  summary links the existing thread and keeps this review's body under the
  link, since the thread still shows the earlier body. That body is where
  the reviewer answers a reply on the thread.
- An open Mogplex thread whose key is not reported again is resolved with a
  reply: "No longer reported at `abc1234`." It is resolved only when the
  run filed a complete structured report; an incomplete or failed review
  changes no thread.
- A native report holds at most 20 findings. A report at that cap may have
  left live findings out, so it resolves nothing, and the earlier findings
  it did not report stay in the new state for the next review.
- An incremental review reads only the files changed since the last one.
  It closes an earlier finding only when that finding's file changed;
  earlier findings elsewhere stay open and stay in the state.
- A critical finding is closed by omission only when its file changed since
  the last review. The reviewer reads the author's replies, so a reply alone
  must not be enough to argue a critical finding away. After a rebase
  (a full review, with no list of changed files) a critical finding stays
  open until it is reported again or a later push changes its file.
- If a key has two threads (a person resolved one, and the finding came
  back), the open one is the finding's thread.
- The state's review time is when the run read the PR, so comments posted
  while it ran are still new to the next review.
- A thread someone resolved by hand stays resolved. If the finding is
  reported again, it gets a new inline comment.

The reporter applies the plan after the inline review is published, then
writes the summary comment with the new state and a "Resolved since the
last review" list.

Two runs can review the same head, for example a rerun started while a
review is in flight. Before publishing, a run reads the summary comments
again. If a verified state there is newer than the time this run read the
PR, another run read it later and has already published. This run then
completes its check run and publishes nothing else (no inline comments, no
thread changes, no summary), so it neither posts duplicates nor overwrites
the newer state. Its outcome is `PR_REVIEW_SUPERSEDED_BY_REVIEW`. The check
is best effort: if the lookup fails, the run publishes as usual.

Every GitHub call here is best effort. A history that fails to load means a
first review. A reply or resolve that fails leaves the thread open, and the
next run tries again. If the thread list cannot be read, a finding the state
records as inline is not posted again (its thread most likely still exists),
nothing is closed, and the state keeps each earlier finding's inline flag.
