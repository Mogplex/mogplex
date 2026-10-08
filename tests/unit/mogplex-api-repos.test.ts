import assert from "node:assert/strict";
import test from "node:test";

async function loadRepos() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/mogplex-api/repos");
}

test("listMogplexApiRepos short-circuits non-UUID id selectors to an empty list", async () => {
  const { listMogplexApiRepos } = await loadRepos();
  // A non-UUID id can never match a repo; it must return [] without hitting
  // Postgres, where the uuid cast would fail and surface as a 500.
  const repos = await listMogplexApiRepos("user-123", {
    id: "owner-name-typed-without-a-slash",
  });
  assert.deepEqual(repos, []);
});

type RepoRow = {
  id: string;
  full_name: string;
  github_installation_id: number;
  default_branch: string;
  root_directory: string | null;
  is_hidden: boolean | null;
};

const ROWS: RepoRow[] = [
  {
    id: "repo-visible",
    full_name: "webrenew/tools",
    github_installation_id: 1,
    default_branch: "main",
    root_directory: null,
    is_hidden: null,
  },
  {
    id: "repo-hidden",
    full_name: "webrenew/supasync",
    github_installation_id: 1,
    default_branch: "main",
    root_directory: null,
    is_hidden: true,
  },
];

// Applies the `or(is_hidden...)` visibility filter the way PostgREST would so
// the test pins which rows each caller sees, not the query text.
async function listWithStubbedRepos(options: { includeHidden?: boolean }) {
  const { supabaseAdmin } = await import("../../lib/supabase/admin");
  const { listMogplexApiRepos } = await loadRepos();
  const originalFrom = supabaseAdmin.from;
  let visibleOnly = false;
  const query = {
    select: () => query,
    eq: () => query,
    order: () => query,
    limit: () => query,
    ilike: () => query,
    or: (filter: string) => {
      visibleOnly = filter === "is_hidden.is.null,is_hidden.eq.false";
      return query;
    },
    then: (resolve: (value: { data: RepoRow[]; error: null }) => void) =>
      resolve({
        data: visibleOnly ? ROWS.filter((row) => row.is_hidden !== true) : ROWS,
        error: null,
      }),
  };
  Object.defineProperty(supabaseAdmin, "from", {
    configurable: true,
    writable: true,
    value: () => query,
  });
  try {
    return await listMogplexApiRepos("user-123", options);
  } finally {
    Object.defineProperty(supabaseAdmin, "from", {
      configurable: true,
      writable: true,
      value: originalFrom,
    });
  }
}

test("listMogplexApiRepos omits dashboard-hidden repos by default", async () => {
  const repos = await listWithStubbedRepos({});
  assert.deepEqual(
    repos.map((repo) => [repo.full_name, repo.hidden]),
    [["webrenew/tools", false]]
  );
});

test("listMogplexApiRepos includes hidden repos, flagged, when asked", async () => {
  // Hidden repos still receive webhooks and automation runs, so the API must
  // list them (and let reviews on them be rerun).
  const repos = await listWithStubbedRepos({ includeHidden: true });
  assert.deepEqual(
    repos.map((repo) => [repo.full_name, repo.hidden]),
    [
      ["webrenew/tools", false],
      ["webrenew/supasync", true],
    ]
  );
});
