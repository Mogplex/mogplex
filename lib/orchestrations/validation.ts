import { normalizeRootDirectory } from "@/lib/repo-settings";
import {
  isValidSandboxBranchName,
  isValidSandboxRootDirectory,
} from "@/lib/sandbox/launch-config";
import {
  assertValidOrchestrationSlug,
  isValidOrchestrationSlug,
  ORCHESTRATION_SLUG_BODY_PATTERN,
} from "./slugs";

export {
  assertValidOrchestrationSlug,
  isValidOrchestrationSlug,
  MAX_ORCHESTRATION_SLUG_LENGTH,
  ORCHESTRATION_SLUG_BODY_PATTERN,
  ORCHESTRATION_SLUG_PATTERN,
  toRunSlug,
  toTaskSlug,
} from "./slugs";

// Mirrors the char_length CHECK on orchestration_runs.title; shared by the
// create and patch routes so the cap cannot drift between them.
export const MAX_ORCHESTRATION_TITLE_LENGTH = 500;

export type ValidationResult<T = string> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export type OwnedPathClaimSpec = {
  slug: string;
  ownedPaths: readonly string[];
  dependsOn?: readonly string[];
};

export type OwnedPathOverlap = {
  leftSlug: string;
  rightSlug: string;
  leftPath: string;
  rightPath: string;
};

const TASK_SPEC_PATH_PATTERN = new RegExp(
  `^(\\d{1,20})-(${ORCHESTRATION_SLUG_BODY_PATTERN})\\.md$`
);

export function buildMasterSpecPath(runSlug: string): string {
  assertValidOrchestrationSlug(runSlug, "Run slug");
  return `specs/${runSlug}/MASTER.md`;
}

export function buildTaskSpecPath(
  runSlug: string,
  orderIndex: number,
  taskSlug: string
): string {
  assertValidOrchestrationSlug(runSlug, "Run slug");
  assertValidOrchestrationSlug(taskSlug, "Task slug");

  if (!Number.isSafeInteger(orderIndex) || orderIndex < 0) {
    throw new TypeError(
      "Task spec orderIndex must be a non-negative safe integer"
    );
  }
  return `specs/${runSlug}/tasks/${orderIndex}-${taskSlug}.md`;
}

export function parseTaskSpecPath(
  filePath: string,
  runSlug: string
): { orderIndex: number; taskSlug: string } | null {
  if (!isValidOrchestrationSlug(runSlug)) return null;

  const prefix = `specs/${runSlug}/tasks/`;
  if (!filePath.startsWith(prefix)) return null;

  const filename = filePath.slice(prefix.length);
  const match = TASK_SPEC_PATH_PATTERN.exec(filename);
  if (!match) return null;

  const orderIndex = Number(match[1]);
  const taskSlug = match[2];
  if (
    !Number.isSafeInteger(orderIndex) ||
    !isValidOrchestrationSlug(taskSlug)
  ) {
    return null;
  }
  return { orderIndex, taskSlug };
}

export function isValidMasterSpecPath(
  filePath: unknown,
  runSlug: string
): boolean {
  return (
    typeof filePath === "string" &&
    isValidOrchestrationSlug(runSlug) &&
    filePath === buildMasterSpecPath(runSlug)
  );
}

export function isValidTaskSpecPath(
  filePath: unknown,
  runSlug: string,
  taskSlug?: string
): boolean {
  if (typeof filePath !== "string") return false;
  const parsed = parseTaskSpecPath(filePath, runSlug);
  if (!parsed) return false;
  return taskSlug === undefined || parsed.taskSlug === taskSlug;
}

export function isValidSpecPath(filePath: unknown, runSlug: string): boolean {
  return (
    isValidMasterSpecPath(filePath, runSlug) ||
    isValidTaskSpecPath(filePath, runSlug)
  );
}

export function validateOrchestrationBranchName(
  branchName: unknown
): ValidationResult {
  if (typeof branchName !== "string" || !isValidSandboxBranchName(branchName)) {
    return { ok: false, error: "Invalid branch name" };
  }
  return { ok: true, value: branchName };
}

export function validateOrchestrationRootDirectory(
  rootDirectory: unknown
): ValidationResult<string | null> {
  if (rootDirectory === undefined || rootDirectory === null) {
    return { ok: true, value: null };
  }

  if (!isValidSandboxRootDirectory(rootDirectory)) {
    return { ok: false, error: "Invalid root directory" };
  }

  return { ok: true, value: normalizeRootDirectory(rootDirectory) };
}

export function normalizeOwnedPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!isValidSandboxRootDirectory(value)) return null;

  const normalized = normalizeRootDirectory(value);
  if (!normalized) return ".";

  const canonicalSegments = normalized
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".");

  return canonicalSegments.length > 0 ? canonicalSegments.join("/") : ".";
}

function pathsOverlap(leftPath: string, rightPath: string): boolean {
  if (leftPath === "." || rightPath === ".") return true;
  return (
    leftPath === rightPath ||
    leftPath.startsWith(`${rightPath}/`) ||
    rightPath.startsWith(`${leftPath}/`)
  );
}

function hasDependencyBetween(
  left: OwnedPathClaimSpec,
  right: OwnedPathClaimSpec,
  specsBySlug: ReadonlyMap<string, OwnedPathClaimSpec>
): boolean {
  return (
    dependsOnSlug(left, right.slug, specsBySlug) ||
    dependsOnSlug(right, left.slug, specsBySlug)
  );
}

function dependsOnSlug(
  spec: OwnedPathClaimSpec,
  targetSlug: string,
  specsBySlug: ReadonlyMap<string, OwnedPathClaimSpec>,
  visited = new Set<string>()
): boolean {
  for (const dependencySlug of spec.dependsOn ?? []) {
    if (dependencySlug === targetSlug) return true;
    if (visited.has(dependencySlug)) continue;

    visited.add(dependencySlug);
    const dependency = specsBySlug.get(dependencySlug);
    if (
      dependency &&
      dependsOnSlug(dependency, targetSlug, specsBySlug, visited)
    ) {
      return true;
    }
  }

  return false;
}

function formatDependencyCycle(slugs: readonly string[]): string {
  return slugs.map((slug) => `"${slug}"`).join(" -> ");
}

function assertAcyclicDependencies(
  specsBySlug: ReadonlyMap<string, OwnedPathClaimSpec>
): void {
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(slug: string, path: string[]): void {
    if (visited.has(slug)) return;

    if (visiting.has(slug)) {
      const cycleStart = path.indexOf(slug);
      const cycle = cycleStart === -1 ? path : path.slice(cycleStart);
      throw new Error(
        `Cyclic OwnedPathClaimSpec dependsOn graph: ${formatDependencyCycle(
          cycle
        )}`
      );
    }

    const spec = specsBySlug.get(slug);
    if (!spec) return;

    visiting.add(slug);
    for (const dependencySlug of spec.dependsOn ?? []) {
      if (!specsBySlug.has(dependencySlug)) continue;
      visit(dependencySlug, [...path, dependencySlug]);
    }
    visiting.delete(slug);
    visited.add(slug);
  }

  for (const slug of specsBySlug.keys()) {
    visit(slug, [slug]);
  }
}

function buildSpecsBySlug(
  specs: readonly OwnedPathClaimSpec[]
): Map<string, OwnedPathClaimSpec> {
  const specsBySlug = new Map<string, OwnedPathClaimSpec>();

  for (const spec of specs) {
    if (specsBySlug.has(spec.slug)) {
      throw new Error(`Duplicate OwnedPathClaimSpec slug: "${spec.slug}"`);
    }

    specsBySlug.set(spec.slug, spec);
  }

  return specsBySlug;
}

function getNormalizedOwnedPaths(spec: OwnedPathClaimSpec): string[] {
  if (spec.ownedPaths.length === 0) {
    throw new Error(
      `OwnedPathClaimSpec "${spec.slug}" must declare at least one owned path`
    );
  }

  return spec.ownedPaths.map((path) => {
    const normalizedPath = normalizeOwnedPath(path);
    if (normalizedPath === null) {
      throw new Error(`Invalid owned path for "${spec.slug}": "${path}"`);
    }

    return normalizedPath;
  });
}

function collectOwnedPathOverlaps(
  left: OwnedPathClaimSpec,
  right: OwnedPathClaimSpec,
  leftPaths: readonly string[],
  rightPaths: readonly string[]
): OwnedPathOverlap[] {
  const overlaps: OwnedPathOverlap[] = [];

  for (const leftPath of leftPaths) {
    for (const rightPath of rightPaths) {
      if (pathsOverlap(leftPath, rightPath)) {
        overlaps.push({
          leftSlug: left.slug,
          rightSlug: right.slug,
          leftPath,
          rightPath,
        });
      }
    }
  }

  return overlaps;
}

export function findOwnedPathOverlaps(
  specs: readonly OwnedPathClaimSpec[]
): OwnedPathOverlap[] {
  const overlaps: OwnedPathOverlap[] = [];
  const specsBySlug = buildSpecsBySlug(specs);
  assertAcyclicDependencies(specsBySlug);

  const normalizedPathsBySlug = new Map<string, string[]>();

  for (const spec of specs) {
    normalizedPathsBySlug.set(spec.slug, getNormalizedOwnedPaths(spec));
  }

  for (let leftIndex = 0; leftIndex < specs.length; leftIndex++) {
    const left = specs[leftIndex];
    if (!left) continue;
    const leftPaths = normalizedPathsBySlug.get(left.slug);
    if (!leftPaths) continue;

    for (
      let rightIndex = leftIndex + 1;
      rightIndex < specs.length;
      rightIndex++
    ) {
      const right = specs[rightIndex];
      if (!right || hasDependencyBetween(left, right, specsBySlug)) continue;
      const rightPaths = normalizedPathsBySlug.get(right.slug);
      if (!rightPaths) continue;

      overlaps.push(
        ...collectOwnedPathOverlaps(left, right, leftPaths, rightPaths)
      );
    }
  }

  return overlaps;
}
