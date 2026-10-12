import { sandboxProjectId } from "./integration-checks";
import { DOCS, type DoctorCheckResult, type DoctorEnv } from "./types";

export type DoctorFetch = (url: string, init: RequestInit) => Promise<Response>;

const LIVE_TIMEOUT_MS = 10_000;

async function probe(
  fetcher: DoctorFetch,
  url: string,
  token: string
): Promise<{ ok: true } | { ok: false; detail: string }> {
  try {
    const response = await fetcher(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(LIVE_TIMEOUT_MS),
    });
    return response.ok
      ? { ok: true }
      : { ok: false, detail: `HTTP ${response.status}` };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.name : "request failed",
    };
  }
}

/** Lists one run with the secret key, which only succeeds for a valid key. */
export async function checkTriggerLive(
  env: DoctorEnv,
  fetcher: DoctorFetch
): Promise<DoctorCheckResult> {
  const result = { id: "trigger-live", docsUrl: DOCS.backgroundJobs };
  const token = env.TRIGGER_SECRET_KEY?.trim();
  if (!token) {
    return {
      ...result,
      status: "skip",
      summary: "TRIGGER_SECRET_KEY is not set",
    };
  }
  const base = env.TRIGGER_API_URL?.trim() || "https://api.trigger.dev";
  const outcome = await probe(
    fetcher,
    new URL("/api/v1/runs?page[size]=1", base).href,
    token
  );
  return outcome.ok
    ? {
        ...result,
        status: "pass",
        summary: "Trigger.dev accepted the secret key",
      }
    : {
        ...result,
        status: "fail",
        summary: `Trigger.dev rejected the secret key (${outcome.detail})`,
      };
}

/** Reads the sandbox project, which needs a token with access to it. */
export async function checkSandboxesLive(
  env: DoctorEnv,
  fetcher: DoctorFetch
): Promise<DoctorCheckResult> {
  const result = { id: "sandboxes-live", docsUrl: DOCS.sandboxesAndModels };
  const token = env.PLATFORM_VERCEL_TOKEN?.trim();
  const projectId = sandboxProjectId(env);
  if (!(token && projectId)) {
    return {
      ...result,
      status: "skip",
      summary: "Vercel token or project ID is not set",
    };
  }
  const url = new URL(
    `https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}`
  );
  const teamId = env.PLATFORM_VERCEL_TEAM_ID?.trim();
  if (teamId) url.searchParams.set("teamId", teamId);
  const outcome = await probe(fetcher, url.href, token);
  return outcome.ok
    ? {
        ...result,
        status: "pass",
        summary: "Vercel token can read the sandbox project",
      }
    : {
        ...result,
        status: "fail",
        summary: `Vercel token cannot read the sandbox project (${outcome.detail})`,
      };
}
