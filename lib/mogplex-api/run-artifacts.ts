import { z } from "zod";
import { getOwnedRepoWithGithubAccessToken } from "@/lib/github-access";
import { loadMogplexApiRun } from "./runs";
import type { MogplexApiRunDetail } from "./runs-types";

// Explicit output files only. Never expose arbitrary checkout files or follow symlinks.
export const runArtifactPathSchema = z
  .string()
  .max(240)
  .regex(/^\.mogplex\/artifacts\/[a-zA-Z0-9][a-zA-Z0-9_-]*\.json$/);
const MAX_ARTIFACT_BYTES = 1024 * 1024;
type Repo = {
  user_id: string;
  full_name: string;
  github_installation_id?: number | null;
};
type Tree = {
  truncated?: boolean;
  tree: Array<{
    path: string;
    mode: string;
    type: string;
    sha: string;
    size?: number;
  }>;
};

export class RunArtifactError extends Error {
  constructor(
    public status: 400 | 404 | 409 | 502,
    message: string
  ) {
    super(message);
  }
}

async function githubJson(token: string, url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 404)
    throw new RunArtifactError(404, "Committed artifact not found");
  if (!response.ok)
    throw new RunArtifactError(502, "Could not read the committed artifact");
  return response.json();
}

export type RunArtifactDeps = {
  loadRun: (input: {
    userId: string;
    runId: string;
  }) => Promise<MogplexApiRunDetail | null>;
  loadRepo: (
    repoId: string,
    userId: string
  ) => Promise<{ repo: Repo | null; githubToken: string | null }>;
  githubJson: typeof githubJson;
};
const defaults: RunArtifactDeps = {
  loadRun: loadMogplexApiRun,
  loadRepo: (repoId, userId) =>
    getOwnedRepoWithGithubAccessToken<Repo>(repoId, userId, {
      select: "user_id, full_name, github_installation_id",
    }),
  githubJson,
};

function assertFinishedBranch(run: MogplexApiRunDetail) {
  if (
    run.status !== "success" ||
    !run.branch.createBranch ||
    run.branch.working === run.branch.base
  )
    throw new RunArtifactError(
      409,
      "Artifacts require a successful run on its own branch"
    );
}

async function readBlobSha(
  base: string,
  treeSha: string,
  path: string,
  read: (url: string) => Promise<unknown>
) {
  const segments = path.split("/");
  let current = treeSha;
  for (const [index, segment] of segments.entries()) {
    const tree = (await read(
      `${base}/git/trees/${encodeURIComponent(current)}`
    )) as Tree;
    const entry = tree.tree.find((item) => item.path === segment);
    if (!entry || tree.truncated)
      throw new RunArtifactError(404, "Committed artifact not found");
    const leaf = index === segments.length - 1;
    assertEntryType(entry, leaf);
    if (leaf && (entry.size ?? MAX_ARTIFACT_BYTES + 1) > MAX_ARTIFACT_BYTES)
      throw new RunArtifactError(400, "Artifact exceeds 1 MiB");
    current = entry.sha;
  }
  return current;
}

function assertEntryType(entry: Tree["tree"][number], leaf: boolean) {
  const allowed = leaf
    ? entry.type === "blob" && ["100644", "100755"].includes(entry.mode)
    : entry.type === "tree" && entry.mode === "040000";
  if (!allowed)
    throw new RunArtifactError(400, "Artifact must be a regular JSON file");
}

function decodeArtifact(raw: unknown) {
  const blob = z
    .object({
      encoding: z.literal("base64"),
      size: z.number().max(MAX_ARTIFACT_BYTES),
      content: z.string().max(1500000),
    })
    .safeParse(raw);
  if (!blob.success)
    throw new RunArtifactError(
      400,
      "Artifact exceeds 1 MiB or has an unsupported encoding"
    );
  const bytes = Buffer.from(blob.data.content, "base64");
  if (bytes.length > MAX_ARTIFACT_BYTES)
    throw new RunArtifactError(400, "Artifact exceeds 1 MiB");
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new RunArtifactError(400, "Artifact is not valid JSON");
  }
}

/** Read an explicit output at one immutable commit, using the run owner's existing repo access. */
export async function loadRunArtifact(
  input: { userId: string; runId: string; path: string },
  overrides: Partial<RunArtifactDeps> = {}
) {
  const deps = { ...defaults, ...overrides };
  const path = runArtifactPathSchema.parse(input.path);
  const run = await deps.loadRun(input);
  if (!run) throw new RunArtifactError(404, "Run not found");
  assertFinishedBranch(run);
  const { repo, githubToken } = await deps.loadRepo(run.repoId, input.userId);
  if (!repo) throw new RunArtifactError(404, "Repository not found");
  if (!githubToken)
    throw new RunArtifactError(409, "Reconnect GitHub to read the artifact");
  const base = `https://api.github.com/repos/${repo.full_name.split("/").map(encodeURIComponent).join("/")}`;
  const read = (url: string) => deps.githubJson(githubToken, url);
  const commit = z
    .object({
      sha: z.string().regex(/^[a-f0-9]{40}$/),
      commit: z.object({ tree: z.object({ sha: z.string() }) }),
    })
    .parse(
      await read(`${base}/commits/${encodeURIComponent(run.branch.working)}`)
    );
  const blobSha = await readBlobSha(base, commit.commit.tree.sha, path, read);
  const content = decodeArtifact(
    await read(`${base}/git/blobs/${encodeURIComponent(blobSha)}`)
  );
  return {
    runId: run.runId,
    repoId: run.repoId,
    path,
    branch: run.branch.working,
    commitSha: commit.sha,
    content,
  };
}
