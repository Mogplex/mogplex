import assert from "node:assert/strict";
import path from "node:path";

export function deployedCommit(project, repository) {
  const link = project?.link;
  assert.equal(
    link?.type,
    "github",
    "Vercel project must have a GitHub repository link"
  );
  assert.equal(
    `${link.org}/${link.repo}`.toLowerCase(),
    repository.toLowerCase(),
    "Vercel project is linked to a different repository"
  );
  const target = project?.targets?.production;
  assert.equal(
    target?.readyState,
    "READY",
    "No ready production deployment to check compatibility against"
  );
  const sha = target?.meta?.githubCommitSha;
  assert.match(
    sha ?? "",
    /^[\da-f]{40}$/i,
    "Production deployment is missing its Git commit SHA"
  );
  return sha;
}

export async function resolveDeployedCommit({
  token,
  project,
  team,
  repository,
}) {
  assert.ok(
    token && project && team && repository,
    "VERCEL_TOKEN, VERCEL_PROJECT_NAME, VERCEL_TEAM_SCOPE and GITHUB_REPOSITORY are required"
  );
  const url = new URL(
    `https://api.vercel.com/v9/projects/${encodeURIComponent(project)}`
  );
  url.searchParams.set("slug", team);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  assert.ok(
    response.ok,
    `Could not read the production deployment (HTTP ${response.status})`
  );
  return deployedCommit(await response.json(), repository);
}

async function main() {
  try {
    const sha = await resolveDeployedCommit({
      token: process.env.VERCEL_TOKEN,
      project: process.env.VERCEL_PROJECT_NAME,
      team: process.env.VERCEL_TEAM_SCOPE,
      repository: process.env.GITHUB_REPOSITORY,
    });
    process.stdout.write(`${sha}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  // Imported by the tsx CommonJS test runner, which cannot load top-level await.
  // eslint-disable-next-line unicorn/prefer-top-level-await
  main();
}
