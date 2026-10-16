import { buildAppUrl } from "@/lib/app-url";
import type { BranchChangedFile } from "@/lib/sandbox/branch-changes";
import type { SlackBlock } from "./client";
import { SLACK_VIEW_CHANGES_ACTION_ID } from "./command-actions";
import { escapeMrkdwn } from "./markdown-to-mrkdwn";
import { summarizeRunChanges, type RunChanges } from "./run-changes";

// Slack caps a modal at 100 blocks and a text object at 3,000 characters.
// The diff budget keeps the view well under Slack's payload limit and
// readable on a phone; the full diff stays on the pull request.
const MODAL_MAX_BLOCKS = 100;
const MODAL_RESERVED_BLOCKS = 5;
const MODAL_PATCH_CHARS = 24_000;
const FILE_PATCH_CHARS = 6_000;
const MIN_FILE_PATCH_CHARS = 400;
const PREFORMATTED_CHARS = 2_900;
const SUMMARY_FILES = 5;
const UNSHOWN_FILE_NAMES = 20;

type ChangedFileSummary = Omit<BranchChangedFile, "patch">;

const STATUS_LABEL: Record<BranchChangedFile["status"], string> = {
  added: "new",
  deleted: "deleted",
  modified: "",
  renamed: "renamed",
};

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Inline code cannot contain a backtick, so swap it for a lookalike. */
function codePath(path: string) {
  return `\`${escapeMrkdwn(path.replace(/`/g, "ˋ"))}\``;
}

/** "3 files changed · +120 −14" */
export function changesTotalsText(files: readonly ChangedFileSummary[]) {
  const totals = summarizeRunChanges(files);
  return `${plural(totals.files, "file")} changed · +${totals.additions} −${totals.deletions}`;
}

function fileLine(file: ChangedFileSummary) {
  const label = STATUS_LABEL[file.status];
  return `${codePath(file.path)} +${file.additions} −${file.deletions}${label ? ` (${label})` : ""}`;
}

/** The result card's Changes section, in mrkdwn. Null when nothing changed. */
export function changesSectionText(files: readonly ChangedFileSummary[]) {
  if (files.length === 0) return null;
  const shown = files.slice(0, SUMMARY_FILES).map(fileLine);
  const more = files.length - shown.length;
  if (more > 0) shown.push(`…and ${plural(more, "more file")}`);
  return `*Changes*\n${changesTotalsText(files)}\n${shown.join("\n")}`;
}

/** Opens the changes modal. Only the run's owner gets the diff. */
export function viewChangesButton(runId: string, text = "View changes") {
  return {
    type: "button",
    text: { type: "plain_text", text },
    action_id: SLACK_VIEW_CHANGES_ACTION_ID,
    value: runId,
  };
}

function sourceText(changes: RunChanges) {
  const branch = codePath(changes.branch);
  const base = codePath(changes.baseBranch);
  return changes.source === "workspace"
    ? `Live workspace on ${branch} compared with ${base}. Includes uncommitted work.`
    : `Pushed branch ${branch} compared with ${base}. Uncommitted work is not included.`;
}

/** Keep hunks; drop the `diff --git`/index/---/+++ header lines. */
export function patchBody(patch: string) {
  const hunk = patch.search(/^@@ /m);
  if (patch.startsWith("diff --git "))
    return hunk === -1 ? "" : patch.slice(hunk);
  return patch;
}

/** Cut at a line boundary. Returns the kept text and how many lines were cut. */
function cutLines(text: string, limit: number) {
  if (text.length <= limit) return { text, cutLines: 0 };
  const head = text.slice(0, limit);
  const lastBreak = head.lastIndexOf("\n");
  const kept = lastBreak > 0 ? head.slice(0, lastBreak) : head;
  const total = text.split("\n").length;
  return { text: kept, cutLines: total - kept.split("\n").length };
}

function chunks(text: string, size: number) {
  const out: string[] = [];
  let rest = text;
  while (rest.length > size) {
    const breakAt = rest.lastIndexOf("\n", size);
    const end = breakAt > 0 ? breakAt + 1 : size;
    out.push(rest.slice(0, end));
    rest = rest.slice(end);
  }
  if (rest) out.push(rest);
  return out;
}

const preformatted = (text: string): SlackBlock => ({
  type: "rich_text",
  elements: [
    { type: "rich_text_preformatted", elements: [{ type: "text", text }] },
  ],
});

const context = (text: string): SlackBlock => ({
  type: "context",
  elements: [{ type: "mrkdwn", text }],
});

const section = (text: string): SlackBlock => ({
  type: "section",
  text: { type: "mrkdwn", text },
});

function fileBlocks(file: BranchChangedFile, patchBudget: number) {
  const heading = `*${codePath(file.path)}*  +${file.additions} −${file.deletions}${
    file.previousPath ? ` · renamed from ${codePath(file.previousPath)}` : ""
  }${file.status === "added" ? " · new file" : file.status === "deleted" ? " · deleted" : ""}`;
  const blocks: SlackBlock[] = [section(heading)];
  const body =
    file.patch === undefined ? null : patchBody(file.patch).trimEnd();
  if (body === null) {
    blocks.push(
      context("Diff not available for this file (binary or too large).")
    );
    return { blocks, used: 0 };
  }
  if (!body) {
    blocks.push(context("No line changes."));
    return { blocks, used: 0 };
  }
  const cut = cutLines(body, Math.min(FILE_PATCH_CHARS, patchBudget));
  for (const piece of chunks(cut.text, PREFORMATTED_CHARS))
    blocks.push(preformatted(piece));
  if (cut.cutLines > 0)
    blocks.push(context(`…${plural(cut.cutLines, "more line")} not shown.`));
  return { blocks, used: cut.text.length };
}

export type RunChangesModalInput = {
  runId: string;
} & (
  | { state: "loading" }
  | { state: "message"; text: string }
  | { state: "ready"; changes: RunChanges }
);

/** The changes modal: one view, reused for loading, messages and the diff. */
export function buildRunChangesModal(input: RunChangesModalInput) {
  const runUrl = buildAppUrl(`/runs/${input.runId}?view=details`).toString();
  const githubUrl = input.state === "ready" ? input.changes.webUrl : undefined;
  const links = [
    ...(githubUrl ? [`<${escapeMrkdwn(githubUrl)}|Open on GitHub>`] : []),
    `<${runUrl}|View run details>`,
  ].join(" · ");
  const blocks: SlackBlock[] = [];
  if (input.state === "loading") {
    blocks.push(section("Reading the run’s changes…"));
  } else if (input.state === "message") {
    blocks.push(section(escapeMrkdwn(input.text)));
  } else if (input.changes.files.length === 0) {
    blocks.push(
      section("*No changes yet.*"),
      context(sourceText(input.changes))
    );
  } else {
    const { changes } = input;
    blocks.push(
      section(`*${changesTotalsText(changes.files)}*`),
      context(sourceText(changes))
    );
    let patchBudget = MODAL_PATCH_CHARS;
    const unshown: BranchChangedFile[] = [];
    for (const file of changes.files) {
      const room = MODAL_MAX_BLOCKS - MODAL_RESERVED_BLOCKS - blocks.length;
      // A file needs its heading plus at least one diff or note block.
      if (
        unshown.length > 0 ||
        room < 3 ||
        patchBudget < MIN_FILE_PATCH_CHARS
      ) {
        unshown.push(file);
        continue;
      }
      const rendered = fileBlocks(file, patchBudget);
      if (rendered.blocks.length > room) {
        unshown.push(file);
        continue;
      }
      blocks.push(...rendered.blocks);
      patchBudget -= rendered.used;
    }
    if (unshown.length > 0) {
      const names = unshown.slice(0, UNSHOWN_FILE_NAMES).map(fileLine);
      const rest = unshown.length - names.length;
      blocks.push(
        { type: "divider" },
        section(
          `*${plural(unshown.length, "more file")} not shown here*\n${names.join("\n")}${rest > 0 ? `\n…and ${rest} more` : ""}`.slice(
            0,
            2_990
          )
        )
      );
    } else if (changes.patchTruncated) {
      blocks.push(context("Some diffs were too large to read in full."));
    }
  }
  blocks.push(context(links));
  return {
    type: "modal",
    title: { type: "plain_text", text: "Run changes" },
    close: { type: "plain_text", text: "Close" },
    private_metadata: input.runId,
    blocks,
  };
}
