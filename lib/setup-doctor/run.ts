import {
  checkAccess,
  checkAppConfig,
  checkAuth,
  checkModels,
  checkSecrets,
} from "./core-checks";
import { checkDatabase, type DatabaseProbe } from "./database-check";
import {
  checkGithubApp,
  checkSandboxes,
  checkTrigger,
} from "./integration-checks";
import {
  checkSandboxesLive,
  checkTriggerLive,
  type DoctorFetch,
} from "./live-checks";
import type { DoctorCheckResult, DoctorEnv } from "./types";

export type SetupDoctorDeps = {
  database: DatabaseProbe;
  fetch: DoctorFetch;
};

export type SetupDoctorOptions = {
  /** Also call Trigger.dev and Vercel to validate credentials. */
  live?: boolean;
};

export async function runSetupDoctor(
  env: DoctorEnv,
  deps: SetupDoctorDeps,
  options: SetupDoctorOptions = {}
): Promise<DoctorCheckResult[]> {
  const results: DoctorCheckResult[] = [
    checkAppConfig(env),
    checkSecrets(env),
    await checkDatabase(env, deps.database),
    checkAuth(env),
    checkGithubApp(env),
    checkTrigger(env),
    checkSandboxes(env),
    checkModels(env),
    checkAccess(env),
  ];
  if (options.live) {
    results.push(
      ...(await Promise.all([
        checkTriggerLive(env, deps.fetch),
        checkSandboxesLive(env, deps.fetch),
      ]))
    );
  }
  return results;
}

export function hasFailures(results: readonly DoctorCheckResult[]): boolean {
  return results.some((result) => result.status === "fail");
}

const STATUS_LABEL = {
  pass: "PASS",
  warn: "WARN",
  fail: "FAIL",
  skip: "SKIP",
} as const;

/** Plain-text table, one row per check, docs links listed under it. */
export function formatDoctorTable(
  results: readonly DoctorCheckResult[]
): string {
  const idWidth = Math.max(5, ...results.map((result) => result.id.length));
  const rows = results.map(
    (result) =>
      `${STATUS_LABEL[result.status].padEnd(6)}  ${result.id.padEnd(idWidth)}  ${result.summary}`
  );
  const needsAttention = results.filter(
    (result) => result.status === "fail" || result.status === "warn"
  );
  const links = needsAttention.map(
    (result) => `  ${result.id}: ${result.docsUrl}`
  );
  return [
    `STATUS  ${"CHECK".padEnd(idWidth)}  DETAILS`,
    ...rows,
    ...(links.length > 0 ? ["", "Fix guides:", ...links] : []),
  ].join("\n");
}
