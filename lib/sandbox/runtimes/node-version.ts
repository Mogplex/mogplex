import { intersects, validRange } from "semver";
import { normalizeRootDirectory } from "@/lib/repo-settings";
import type { RepositoryFiles } from "../repository-files";

type NodeRuntime = "node22" | "node24";

export function selectNodeRuntime(input: {
  versionFile?: string | null;
  engines: string[];
}): NodeRuntime {
  const pin = input.versionFile?.trim().replace(/^v(?=\d)/, "");
  const ranges = [...input.engines];
  if (pin) ranges.push(pin === "node" || pin === "lts/*" ? "24.x" : pin);
  for (const range of ranges) {
    if (!validRange(range))
      throw new Error(`Invalid Node.js requirement: ${range}`);
  }
  for (const major of [22, 24] as const) {
    if (ranges.every((range) => intersects(range, `${major}.x`)))
      return `node${major}`;
  }
  throw new Error(
    `This repository needs Node.js ${ranges.join(" and ")}. Available sandbox runtimes are Node.js 22 and 24. Update the repository requirement or choose a compatible runtime in repository settings.`
  );
}

/** Workspace declarations take precedence for version files; ancestor engines still apply. */
export async function detectNodeRuntimeFromFiles(
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
  return selectNodeRuntime({
    engines: declarations.flatMap(({ engine }) => (engine ? [engine] : [])),
    versionFile: declarations.find(({ version }) => version)?.version,
  });
}
