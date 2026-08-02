import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type TriggerVercelBuildEnv = {
  vercelAccessToken: string | null;
  vercelProjectId: string | null;
  vercelTeamId: string | null;
  envSyncEnabled: boolean;
};

function firstNonEmpty(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  return null;
}

function readLinkedVercelProjectId(projectLinkPath: string) {
  if (!existsSync(projectLinkPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(projectLinkPath, "utf8")) as {
      projectId?: unknown;
    };
    return typeof parsed.projectId === "string" && parsed.projectId.trim()
      ? parsed.projectId.trim()
      : null;
  } catch {
    return null;
  }
}

export function resolveTriggerVercelBuildEnv(
  env: NodeJS.ProcessEnv = process.env,
  projectLinkPath = resolve(process.cwd(), ".vercel", "project.json")
): TriggerVercelBuildEnv {
  const vercelAccessToken = firstNonEmpty(
    env.VERCEL_ACCESS_TOKEN,
    env.PLATFORM_VERCEL_TOKEN
  );
  const vercelProjectId = firstNonEmpty(
    env.VERCEL_PROJECT_ID,
    env.PLATFORM_VERCEL_PROJECT_ID,
    readLinkedVercelProjectId(projectLinkPath)
  );
  const vercelTeamId = firstNonEmpty(
    env.VERCEL_TEAM_ID,
    env.PLATFORM_VERCEL_TEAM_ID
  );

  return {
    vercelAccessToken,
    vercelProjectId,
    vercelTeamId,
    envSyncEnabled: Boolean(vercelAccessToken && vercelProjectId),
  };
}

export function applyTriggerVercelBuildEnv(
  env: NodeJS.ProcessEnv = process.env,
  projectLinkPath = resolve(process.cwd(), ".vercel", "project.json")
) {
  const resolved = resolveTriggerVercelBuildEnv(env, projectLinkPath);

  if (resolved.vercelAccessToken) {
    env.VERCEL_ACCESS_TOKEN = resolved.vercelAccessToken;
  }

  if (resolved.vercelProjectId) {
    env.VERCEL_PROJECT_ID = resolved.vercelProjectId;
  }

  if (resolved.vercelTeamId) {
    env.VERCEL_TEAM_ID = resolved.vercelTeamId;
  }

  return resolved;
}
