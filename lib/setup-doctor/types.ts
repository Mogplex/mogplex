export type DoctorStatus = "pass" | "warn" | "fail" | "skip";

export type DoctorCheckResult = {
  id: string;
  status: DoctorStatus;
  /** One line for a terminal table. Never contains a secret value. */
  summary: string;
  docsUrl: string;
};

export type DoctorEnv = Readonly<Record<string, string | undefined>>;

const DOCS_BASE = "https://docs.mogplex.com/self-hosting";

export const DOCS = {
  environmentVariables: `${DOCS_BASE}/environment-variables`,
  databaseAndAuth: `${DOCS_BASE}/database-and-auth`,
  githubApp: `${DOCS_BASE}/github-app`,
  backgroundJobs: `${DOCS_BASE}/background-jobs`,
  sandboxesAndModels: `${DOCS_BASE}/sandboxes-and-models`,
  giveUsersAccess: `${DOCS_BASE}/sandboxes-and-models#give-users-access`,
  operations: `${DOCS_BASE}/operations`,
} as const;

export function configured(env: DoctorEnv, name: string): boolean {
  return Boolean(env[name]?.trim());
}

export function missing(env: DoctorEnv, names: readonly string[]): string[] {
  return names.filter((name) => !configured(env, name));
}
