import { intersects, validRange, valid, satisfies, rcompare } from "semver";
import { normalizeRootDirectory } from "@/lib/repo-settings";
import type { RepositoryFiles } from "../repository-files";

export type NodeRuntime = "node22" | "node24" | "node26";

export type NodeRequirements = {
  versionFile?: string | null;
  engines: string[];
};

function nodeRanges(input: NodeRequirements) {
  const pin = input.versionFile?.trim().replace(/^v(?=\d)/, "");
  const ranges = [...input.engines];
  if (pin) ranges.push(pin === "node" || pin === "lts/*" ? "24.x" : pin);
  for (const range of ranges) {
    if (!validRange(range))
      throw new Error(`Invalid Node.js requirement: ${range}`);
  }
  return ranges;
}

export function satisfiesNodeRequirements(
  version: string,
  runtime: NodeRuntime,
  input: NodeRequirements
) {
  return (
    satisfies(version, `${runtime.slice(4)}.x`) &&
    nodeRanges(input).every((range) => satisfies(version, range))
  );
}

export function selectNodeVersion(
  versions: string[],
  runtime: NodeRuntime,
  input: NodeRequirements
) {
  const version = versions
    .flatMap((value) => (valid(value) ? [valid(value)!] : []))
    .filter((value) => satisfiesNodeRequirements(value, runtime, input))
    .sort(rcompare)[0];
  if (!version)
    throw new Error(
      `No published Node.js version satisfies ${nodeRanges(input).join(" and ")} on ${runtime}.`
    );
  return version;
}

export function selectNodeRuntime(input: NodeRequirements): NodeRuntime {
  const ranges = nodeRanges(input);
  for (const major of [22, 24, 26] as const) {
    if (ranges.every((range) => intersects(range, `${major}.x`)))
      return `node${major}`;
  }
  throw new Error(
    `This repository needs Node.js ${ranges.join(" and ")}. Available sandbox runtimes are Node.js 22, 24, and 26. Update the repository requirement or choose a compatible runtime in repository settings.`
  );
}

/** Workspace declarations take precedence for version files; ancestor engines still apply. */
export async function readNodeRequirements(
  files: RepositoryFiles,
  rootDirectory?: string | null
) {
  const root = normalizeRootDirectory(rootDirectory);
  const parts = root?.split("/") ?? [];
  const directories = Array.from({ length: parts.length + 1 }, (_, index) =>
    parts.slice(0, parts.length - index).join("/")
  );
  const declarations = await Promise.all(
    directories.map(async (directory) => {
      const prefix = directory ? `${directory}/` : "";
      const [pkg, nvmrc, nodeVersion] = await Promise.all([
        files.readText(`${prefix}package.json`),
        files.readText(`${prefix}.nvmrc`),
        files.readText(`${prefix}.node-version`),
      ]);
      const value: unknown = pkg ? JSON.parse(pkg) : null;
      const engine =
        value && typeof value === "object" && "engines" in value
          ? (value as { engines?: { node?: unknown } }).engines?.node
          : null;
      return {
        engine: typeof engine === "string" ? engine : null,
        version: nvmrc?.trim() || nodeVersion?.trim() || null,
      };
    })
  );
  return {
    engines: declarations.flatMap(({ engine }) => (engine ? [engine] : [])),
    versionFile: declarations.find(({ version }) => version)?.version,
  };
}

export async function detectNodeRuntimeFromFiles(
  files: RepositoryFiles,
  rootDirectory?: string | null
) {
  return selectNodeRuntime(await readNodeRequirements(files, rootDirectory));
}
