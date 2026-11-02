/** Commands are chosen from named project scripts, never inferred compiler flags. */
export const CHECK_KINDS = ["typecheck", "lint", "build", "test"] as const;
export type CheckKind = (typeof CHECK_KINDS)[number];
export type PlannedRepositoryCheck = {
  kind: CheckKind;
  command: string | null;
  reason?: string;
};

const SCRIPT_NAMES: Record<CheckKind, readonly string[]> = {
  typecheck: ["typecheck", "type-check", "check:types", "check-types"],
  lint: ["lint:ci", "lint"],
  build: ["build"],
  test: ["test:all", "test:ci", "test"],
};
const LOCKFILE_MANAGERS: Record<string, string> = {
  "pnpm-lock.yaml": "pnpm",
  "package-lock.json": "npm",
  "npm-shrinkwrap.json": "npm",
  "yarn.lock": "yarn",
  "bun.lock": "bun",
  "bun.lockb": "bun",
};

export const REPOSITORY_CHECK_LOCKFILES = Object.keys(LOCKFILE_MANAGERS);

type RepositoryCheckManifest = {
  packageManager?: unknown;
  scripts?: unknown;
  lockfiles: readonly string[];
};

function resolvePackageManager(input: RepositoryCheckManifest) {
  if (input.packageManager !== undefined && input.packageManager !== null) {
    const match =
      typeof input.packageManager === "string"
        ? /^(npm|pnpm|yarn|bun)@[\w.+-]+$/.exec(input.packageManager)
        : null;
    return match
      ? { manager: match[1] }
      : {
          reason:
            "The declared package manager is unsupported or invalid. Inspect the repository instructions before running checks.",
        };
  }
  const managers = [
    ...new Set(
      input.lockfiles.flatMap((file) =>
        Object.hasOwn(LOCKFILE_MANAGERS, file) ? [LOCKFILE_MANAGERS[file]] : []
      )
    ),
  ];
  return managers.length > 1
    ? {
        reason:
          "Conflicting lockfiles make the package manager ambiguous. Inspect the repository instructions before running checks.",
      }
    : { manager: managers[0] ?? "npm" };
}

export function buildRepositoryCheckPlan(
  input: RepositoryCheckManifest
): PlannedRepositoryCheck[] {
  const manager = resolvePackageManager(input);
  if ("reason" in manager) {
    return CHECK_KINDS.map((kind) => ({
      kind,
      command: null,
      reason: manager.reason,
    }));
  }
  const scripts =
    input.scripts &&
    typeof input.scripts === "object" &&
    !Array.isArray(input.scripts)
      ? (input.scripts as Record<string, unknown>)
      : {};
  return CHECK_KINDS.map((kind) => {
    const name = SCRIPT_NAMES[kind].find(
      (candidate) =>
        typeof scripts[candidate] === "string" &&
        scripts[candidate].trim().length > 0
    );
    return name
      ? { kind, command: `CI=1 ${manager.manager} run ${name}` }
      : {
          kind,
          command: null,
          reason: `No ${kind} script is defined in package.json. Inspect repository instructions and CI before claiming this check is not applicable.`,
        };
  });
}
