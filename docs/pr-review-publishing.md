# How a PR review is published

A finished review is published in three places, each with one job:

| Surface | Job | Code |
| --- | --- | --- |
| Check run (`Mogplex PR Review`) | The verdict, for branch protection and the Checks tab. The summary is shown once; the text adds the findings. | `publishPrReviewCheckRun` |
| Inline comments (one native review) | Findings that can sit on the diff, one comment each. The review body only points at the summary comment. | `publishPrReviewGithubReview` |
| Summary comment (`<!-- mogplex-pr-review -->`) | The canonical review: verdict, summary, every finding. Updated in place on every run. Findings posted inline are listed by link, not repeated. | `publishPrReviewTimelineComment` |

The order is check run, then inline comments, then the summary comment, so
the summary can link the inline comments.

The summary comment is published on every run. A failure to publish it
fails the run only when no inline review carries the findings: retrying a
run whose inline review already landed would post that review twice.

## Verdict

`prReviewVerdict` decides from the findings, not from the model's
`hasIssues` flag:

| Verdict | When | Check conclusion | Status line |
| --- | --- | --- | --- |
| `blocking` | Any critical or warning finding, or `hasIssues` with no findings | `neutral` | Attention needed |
| `suggestions` | Only suggestion findings | `success` | No blocking issues, suggestions only |
| `clean` | No findings | `success` | No material issues found |
| `incomplete` | The reviewer filed no report | `neutral` | Review incomplete |

The run metadata records the verdict as `review_verdict` beside
`review_has_issues`, which keeps the model's own flag.

Flow auto-merge follows the same verdict: `blocking` and `incomplete` stop
the merge, `suggestions` and `clean` let it through.

## Anchoring

`anchorReviewFindings` (`lib/workflows/pr-review-anchors.ts`) places each
finding against the lines the PR's diff shows (`loadPullRequestChangedLines`
reads every page of `pulls/{n}/files`):

- The finding's line is in the diff: the comment goes on that line.
- The line is outside the diff, or the finding names no line: the comment
  goes on the nearest changed line of that file and says which line it is
  about, or that it is about the file as a whole.
- The file is not in the diff (or has no patch, such as a binary file), or
  the finding has no path: no inline comment; the summary comment carries
  the finding in full.

If the diff cannot be loaded, only findings that name a path and a line are
posted inline. If GitHub rejects the review, nothing is posted inline and
the summary comment carries every finding in full.
