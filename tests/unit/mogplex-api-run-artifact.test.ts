import assert from "node:assert/strict";
import test from "node:test";
import { presentMogplexApiRun } from "../../lib/mogplex-api/runs";
import {
  buildRunRow,
  buildUser,
  loadRunDetailRoute,
} from "./helpers/mogplex-api-runs-fixtures";

const commitSha = "a".repeat(40);
const path = ".mogplex/artifacts/preview-test.json";

function matchesMalformedProvider(url: string, malformed?: "commit" | "tree") {
  return (
    (malformed === "commit" && url.includes("/commits/")) ||
    (malformed === "tree" && url.includes("/trees/"))
  );
}

type SetupOptions = {
  owned?: boolean;
  status?: "success" | "streaming";
  mode?: string;
  /** Git entry type for the leaf file. Defaults to "blob". */
  entryType?: string;
  content?: string;
  providerFailure?: boolean;
  malformed?: "commit" | "tree";
  rootDirectory?: string;
  repositoryFailure?: boolean;
  createBranch?: boolean;
  workingBranch?: string;
  githubToken?: string | null;
  commitSha?: string;
  truncated?: boolean;
  /** Entry size. Use null to omit the size field entirely (simulating GitHub's behavior for missing size). */
  leafSize?: number | null;
  blob?: Record<string, unknown>;
  // Exercise the production githubJson against a mocked global fetch.
  realGithub?: boolean;
  /** Terminal commit SHA recorded in run metadata, pins artifact reads. */
  terminalCommitSha?: string | null;
};

/** Provider responses for the happy path, keyed by the URL suffix they answer. */
function providerFixtures(options: SetupOptions): [string, unknown][] {
  // Build leaf entry: null leafSize means omit size field entirely
  const leafBase = {
    path: "preview-test.json",
    mode: options.mode ?? "100644",
    type: options.entryType ?? "blob",
    sha: "blob",
  };
  const leaf =
    options.leafSize === null
      ? leafBase // Omit size field
      : { ...leafBase, size: options.leafSize ?? 10 };
  const blob = options.blob ?? {
    encoding: "base64",
    size: 10,
    content: Buffer.from(options.content ?? '{"ready":true}').toString(
      "base64"
    ),
  };
  // Support pinned commit SHA: use it as the commit ref if provided
  const commitRef =
    options.terminalCommitSha ??
    options.workingBranch ??
    "mogplex/external/run";
  return [
    [
      `/commits/${encodeURIComponent(commitRef)}`,
      {
        sha: options.commitSha ?? commitSha,
        commit: { tree: { sha: "root" } },
      },
    ],
    [
      "/trees/root",
      {
        truncated: options.truncated,
        tree: [{ path: ".mogplex", mode: "040000", type: "tree", sha: "dir" }],
      },
    ],
    [
      "/trees/dir",
      {
        tree: [
          { path: "artifacts", mode: "040000", type: "tree", sha: "artifacts" },
        ],
      },
    ],
    ["/trees/artifacts", { tree: [leaf] }],
    ["/blobs/blob", blob],
  ];
}

async function setup(options: SetupOptions = {}) {
  await loadRunDetailRoute();
  const { loadRunArtifact, RunArtifactError } =
    await import("../../lib/mogplex-api/run-artifacts");
  const { createRunArtifactGetHandler } =
    await import("../../app/api/v1/mogplex/runs/[runId]/artifact/route");
  const urls: string[] = [];
  const githubJson = async (_token: string, url: string) => {
    urls.push(url);
    if (matchesMalformedProvider(url, options.malformed))
      return { private: "PRIVATE PROVIDER CONTENT" };
    if (options.providerFailure)
      throw new RunArtifactError(502, "Could not read the committed artifact");
    const fixture = providerFixtures(options).find(([suffix]) =>
      url.endsWith(suffix)
    );
    if (fixture) return fixture[1];
    throw new Error("Unexpected GitHub URL");
  };
  const handler = createRunArtifactGetHandler({
    resolveApiKey: async () => ({ ok: true, auth: buildUser() }),
    loadArtifact: (input) =>
      loadRunArtifact(input, {
        loadRun: async ({ userId }) =>
          options.owned === false || userId !== "user-123"
            ? null
            : presentMogplexApiRun(
                buildRunRow({
                  status: options.status ?? "success",
                  create_branch: options.createBranch ?? true,
                  working_branch:
                    options.workingBranch ?? "mogplex/external/run",
                  root_directory: options.rootDirectory ?? null,
                  metadata:
                    options.terminalCommitSha === undefined
                      ? {}
                      : { terminal_commit_sha: options.terminalCommitSha },
                })
              ),
        loadRepo: async () => {
          if (options.repositoryFailure)
            throw new TypeError("PRIVATE DATABASE DETAIL");
          return {
            repo: { user_id: "user-123", full_name: "webrenew/previews" },
            githubToken:
              options.githubToken === undefined
                ? "test-token"
                : options.githubToken,
          };
        },
        ...(options.realGithub ? {} : { githubJson }),
      }),
  });
  const request = (artifactPath = path, auth = true) =>
    handler(
      new Request(
        `https://mogplex.com/api/v1/mogplex/runs/run-1/artifact?path=${encodeURIComponent(artifactPath)}`,
        { headers: auth ? { authorization: "Bearer mog_test" } : {} }
      ),
      { params: Promise.resolve({ runId: "run-1" }) }
    );
  return { request, urls };
}

test("artifact reads a regular JSON blob from the branch tip when no terminal SHA recorded (unpinned)", async () => {
  const { request, urls } = await setup();
  const response = await request();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const artifact = (await response.json()).data.artifact;
  assert.deepEqual(artifact, {
    runId: "run-1",
    repoId: "repo-1",
    branch: "mogplex/external/run",
    commitSha,
    path,
    pinned: false,
    content: { ready: true },
  });
  assert.equal(urls.filter((url) => url.includes("/commits/")).length, 1);
  // Verify the commit fetch was against the branch name (unpinned)
  assert.ok(
    urls.some((url) =>
      url.includes(`/commits/${encodeURIComponent("mogplex/external/run")}`)
    )
  );
});

test("anonymous and cross-owner artifact reads are refused", async () => {
  const anonymous = await setup();
  assert.equal((await anonymous.request(path, false)).status, 401);
  assert.equal(anonymous.urls.length, 0);
  const other = await setup({ owned: false });
  assert.equal((await other.request()).status, 404);
  assert.equal(other.urls.length, 0);
});

test("artifact rejects traversal and non-output paths before provider access", async () => {
  const { request, urls } = await setup();
  for (const invalid of [
    ".env",
    ".mogplex/artifacts/../../secrets.json",
    ".mogplex/artifacts/secret.txt",
    "package.json",
  ])
    assert.equal((await request(invalid)).status, 400);
  assert.equal(urls.length, 0);
});

test("unfinished runs and symlinks cannot provide artifacts", async () => {
  const active = await setup({ status: "streaming" });
  assert.equal((await active.request()).status, 409);
  assert.equal(active.urls.length, 0);
  const symlink = await setup({ mode: "120000" });
  assert.equal((await symlink.request()).status, 400);
  assert.ok(!symlink.urls.some((url) => url.includes("/blobs/")));
});

test("invalid JSON and provider failures return safe errors", async () => {
  const invalid = await setup({ content: "PRIVATE INVALID DATA" });
  const response = await invalid.request();
  assert.equal(response.status, 400);
  assert.ok(!(await response.text()).includes("PRIVATE"));
  const failure = await setup({ providerFailure: true });
  assert.equal((await failure.request()).status, 502);
});

test("malformed provider commits and trees return a sanitized 502", async () => {
  for (const malformed of ["commit", "tree"] as const) {
    const { request } = await setup({ malformed });
    const response = await request();
    assert.equal(response.status, 502);
    assert.ok(!(await response.text()).includes("PRIVATE"));
  }
});
test("monorepo artifacts are explicitly anchored at the repository root", async () => {
  const { request } = await setup({ rootDirectory: "apps/web" });
  const response = await request();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.artifact.path, path);
});

test("unexpected failures log an error class without private content", async (context) => {
  const log = context.mock.method(console, "error", () => {});
  const { request } = await setup({ repositoryFailure: true });
  const response = await request();
  assert.equal(response.status, 500);
  assert.ok(!(await response.text()).includes("PRIVATE"));
  assert.deepEqual(log.mock.calls[0].arguments[1], {
    runId: "run-1",
    errorType: "TypeError",
  });
});

test("network-level GitHub failures and timeouts return 502, not 500", async (context) => {
  for (const failure of [
    new TypeError("fetch failed"),
    new DOMException("The operation timed out.", "TimeoutError"),
    new DOMException("This operation was aborted", "AbortError"),
  ]) {
    const fetchMock = context.mock.method(globalThis, "fetch", async () => {
      throw failure;
    });
    const { request } = await setup({ realGithub: true });
    const response = await request();
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, "SERVICE_UNAVAILABLE");
    assert.equal(fetchMock.mock.callCount(), 1);
    fetchMock.mock.restore();
  }
});

test("SHA-256 object-format commits are accepted; other lengths are not", async () => {
  const sha256 = await setup({ commitSha: "b".repeat(64) });
  const response = await sha256.request();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.artifact.commitSha, "b".repeat(64));
  for (const invalid of ["c".repeat(41), "d".repeat(63), "e".repeat(65)]) {
    const { request } = await setup({ commitSha: invalid });
    assert.equal((await request()).status, 502);
  }
});

// Each blob below is otherwise valid JSON, so only the targeted guard can refuse it.
const readyBase64 = Buffer.from('{"ready":true}').toString("base64");

test("oversized artifacts are refused before or after the blob read", async () => {
  const leaf = await setup({ leafSize: 1024 * 1024 + 1 });
  assert.equal((await leaf.request()).status, 400);
  assert.ok(!leaf.urls.some((url) => url.includes("/blobs/")));
  const declared = await setup({
    blob: { encoding: "base64", size: 1024 * 1024 + 1, content: readyBase64 },
  });
  assert.equal((await declared.request()).status, 400);
  const decoded = await setup({
    blob: {
      encoding: "base64",
      size: 10,
      content: Buffer.from(`${" ".repeat(1024 * 1024)}{}`).toString("base64"),
    },
  });
  assert.equal((await decoded.request()).status, 400);
});

test("unsupported blob encodings are refused", async () => {
  const { request } = await setup({
    blob: { encoding: "none", size: 14, content: readyBase64 },
  });
  const response = await request();
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "BAD_REQUEST");
});

test("truncated provider trees are treated as not found", async () => {
  const { request, urls } = await setup({ truncated: true });
  assert.equal((await request()).status, 404);
  assert.ok(!urls.some((url) => url.includes("/blobs/")));
});

test("a missing GitHub connection returns 409 without provider access", async () => {
  const { request, urls } = await setup({ githubToken: null });
  const response = await request();
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "CONFLICT");
  assert.equal(urls.length, 0);
});

test("runs without their own branch cannot provide artifacts", async () => {
  for (const options of [{ createBranch: false }, { workingBranch: "main" }]) {
    const { request, urls } = await setup(options);
    assert.equal((await request()).status, 409);
    assert.equal(urls.length, 0);
  }
});

test("pinned artifacts use the recorded terminal commit SHA instead of branch tip", async () => {
  const pinnedSha = "f".repeat(40);
  const { request, urls } = await setup({ terminalCommitSha: pinnedSha });
  const response = await request();
  assert.equal(response.status, 200);
  const artifact = (await response.json()).data.artifact;
  assert.equal(artifact.pinned, true);
  // Verify the commit fetch was against the pinned SHA
  assert.ok(urls.some((url) => url.includes(`/commits/${pinnedSha}`)));
  // Verify the commit fetch was NOT against the branch name
  assert.ok(
    !urls.some((url) =>
      url.includes(`/commits/${encodeURIComponent("mogplex/external/run")}`)
    )
  );
});

test("submodule entries (type=commit mode=160000) are refused", async () => {
  const { request, urls } = await setup({
    entryType: "commit",
    mode: "160000",
  });
  const response = await request();
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, "BAD_REQUEST");
  assert.ok(body.error.message.includes("regular JSON file"));
  // The blob should never be fetched for a submodule
  assert.ok(!urls.some((url) => url.includes("/blobs/")));
});

test("missing entry.size is treated as oversized and refused before blob read", async () => {
  // Pass leafSize as null to omit size from the entry
  const { request, urls } = await setup({ leafSize: null });
  const response = await request();
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, "BAD_REQUEST");
  assert.ok(body.error.message.includes("1 MiB"));
  // The blob should never be fetched when entry appears oversized
  assert.ok(!urls.some((url) => url.includes("/blobs/")));
});

test("GitHub provider failures are logged with status code classification", async (context) => {
  const logMock = context.mock.method(console, "error", () => {});
  const fetchMock = context.mock.method(globalThis, "fetch", async () => ({
    ok: false,
    status: 429,
    json: async () => ({}),
  }));
  const { request } = await setup({ realGithub: true });
  const response = await request();
  assert.equal(response.status, 502);
  assert.ok(
    logMock.mock.calls.some(
      (call) =>
        call.arguments[0] === "[artifact] GitHub returned error" &&
        call.arguments[1]?.status === 429 &&
        call.arguments[1]?.errorClass === "rate_limit"
    )
  );
  fetchMock.mock.restore();
});

test("GitHub network failures are logged with error class", async (context) => {
  const logMock = context.mock.method(console, "error", () => {});
  const fetchMock = context.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("fetch failed");
  });
  const { request } = await setup({ realGithub: true });
  const response = await request();
  assert.equal(response.status, 502);
  assert.ok(
    logMock.mock.calls.some(
      (call) =>
        call.arguments[0] === "[artifact] GitHub request failed" &&
        call.arguments[1]?.errorClass === "TypeError"
    )
  );
  fetchMock.mock.restore();
});
