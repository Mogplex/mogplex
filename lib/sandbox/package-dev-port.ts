import { posix } from "node:path";
import { parsePnpmWorkspaceGlobs } from "@/lib/monorepo-detection";
import type { RepositoryFiles } from "./repository-files";

type Package = {
  name?: string;
  scripts?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
};
const IGNORED_DIRECTORIES = new Set(["node_modules", ".git", ".mogplex"]);

function repoPath(base: string, relative: string): string | null {
  if (
    posix.isAbsolute(relative) ||
    relative.includes("\\") ||
    relative.includes("\0")
  )
    return null;
  const path = posix.normalize(posix.join(base, relative));
  return path === ".." || path.startsWith("../")
    ? null
    : path === "."
      ? ""
      : path;
}

function portNumber(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const port = Number(value);
  return port > 0 && port <= 65535 ? port : null;
}

/** Only inspect simple commands; never evaluate shell expansions or run scripts. */
function words(command: string): string[] | null {
  if (/[;&|<>`$\\\r\n]/.test(command)) return null;
  const tokens = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  if (tokens.join("").replace(/\s/g, "") !== command.replace(/\s/g, ""))
    return null;
  return tokens.map((token) => token.replace(/["']/g, ""));
}

function option(tokens: string[], names: string[]): string[] {
  return tokens.flatMap((token, index) => {
    if (names.includes(token))
      return tokens[index + 1] ? [tokens[index + 1]] : [];
    const name = names.find((value) => token.startsWith(`${value}=`));
    return name ? [token.slice(name.length + 1)] : [];
  });
}

function globMatches(pattern: string, path: string): boolean {
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${escaped.join("[^/]*")}$`).test(path);
}

export async function resolvePackageDevPort(
  files: RepositoryFiles,
  input: {
    rootDirectory?: string | null;
    devCommand?: string | null;
  }
): Promise<number | null> {
  const packages = new Map<string, Promise<Package | null>>();
  const readPackage = (path: string) => {
    let pending = packages.get(path);
    if (!pending) {
      pending = files.readText(posix.join(path, "package.json")).then((raw) => {
        if (!raw) return null;
        try {
          const value: unknown = JSON.parse(raw);
          if (!value || typeof value !== "object" || Array.isArray(value))
            return null;
          const pkg = value as Package;
          const workspaceValue = Array.isArray(pkg.workspaces)
            ? pkg.workspaces
            : pkg.workspaces?.packages;
          return {
            ...pkg,
            workspaces: Array.isArray(workspaceValue)
              ? workspaceValue.filter(
                  (path): path is string => typeof path === "string"
                )
              : [],
          };
        } catch {
          return null;
        }
      });
      packages.set(path, pending);
    }
    return pending;
  };
  let workspacePaths: Promise<string[]> | undefined;
  const workspaces = () =>
    (workspacePaths ??= (async () => {
      const root = await readPackage("");
      const yaml = await files.readText("pnpm-workspace.yaml");
      const configured = yaml ? parsePnpmWorkspaceGlobs(yaml) : [];
      const globs =
        configured.length > 0
          ? configured
          : Array.isArray(root?.workspaces)
            ? root.workspaces
            : (root?.workspaces?.packages ?? []);
      const found = new Set<string>();
      for (const glob of globs) {
        if (typeof glob !== "string" || glob.startsWith("!")) continue;
        const normalized = repoPath("", glob);
        if (!normalized) continue;
        let paths = [""];
        for (const segment of normalized.split("/")) {
          if (segment === "**") {
            paths = [];
            break;
          }
          if (!segment.includes("*")) {
            paths = paths.map((path) => posix.join(path, segment));
            continue;
          }
          const expanded = await Promise.all(
            paths.map(async (path) =>
              (await files.listDirectories(path))
                .filter(
                  (name) =>
                    !IGNORED_DIRECTORIES.has(name) &&
                    !name.includes("/") &&
                    name !== ".." &&
                    globMatches(segment, name)
                )
                .map((name) => posix.join(path, name))
            )
          );
          paths = expanded.flat();
        }
        for (const path of paths) found.add(path);
      }
      return [...found].filter(
        (path) =>
          !globs.some(
            (glob) =>
              typeof glob === "string" &&
              glob.startsWith("!") &&
              globMatches(glob.slice(1), path)
          )
      );
    })());
  const seen = new Set<string>();

  const resolveScript = async (
    root: string,
    script: string,
    envPort: number | null
  ): Promise<number | null> => {
    const key = `${root}:${script}`;
    if (seen.has(key)) return null;
    seen.add(key);
    const command = (await readPackage(root))?.scripts?.[script];
    return typeof command === "string"
      ? resolveCommand(root, command, envPort)
      : null;
  };

  const resolveCommand = async (
    commandRoot: string,
    command: string,
    inheritedPort: number | null
  ): Promise<number | null> => {
    let root = commandRoot;
    const tokens = words(command);
    if (!tokens?.length) return null;
    const flags = option(tokens, ["--port", "-p"]);
    if (flags.length > 0) return portNumber(flags.at(-1));
    let envPort = inheritedPort;
    if (["env", "cross-env"].includes(tokens[0])) tokens.shift();
    while (tokens[0]?.includes("=")) {
      const assignment = tokens.shift()!;
      if (assignment.startsWith("PORT="))
        envPort = portNumber(assignment.slice(5));
    }
    const manager = tokens.shift();
    if (!["npm", "pnpm", "yarn", "bun"].includes(manager ?? "")) return envPort;

    const dirs = option(tokens, ["--dir", "--cwd", "--prefix", "-C"]);
    const selectors = option(tokens, [
      "--filter",
      "-F",
      "--workspace",
      "-w",
      "workspace",
    ]);
    if (
      dirs.length > 1 ||
      selectors.length > 1 ||
      (dirs.length > 0 && selectors.length > 0)
    )
      return null;
    if (dirs.length > 0) {
      const target = repoPath(root, dirs[0]);
      if (target === null) return null;
      root = target;
    }
    if (selectors.length > 0) {
      const selector = selectors[0];
      if (/[*![\]{}]|\.\.\./.test(selector)) return null;
      const candidates = await Promise.all(
        (await workspaces()).map(async (path) => ({
          path,
          pkg: await readPackage(path),
        }))
      );
      const matches = candidates.filter(
        ({ path, pkg }) =>
          pkg?.name === selector || path === repoPath("", selector)
      );
      if (matches.length !== 1) return null;
      root = matches[0].path;
    }
    const names = new Set([
      "--dir",
      "--cwd",
      "--prefix",
      "-C",
      "--filter",
      "-F",
      "--workspace",
      "-w",
      "workspace",
    ]);
    const positional = tokens.filter(
      (token, index) =>
        !names.has(token) &&
        !names.has(tokens[index - 1]) &&
        !token.startsWith("-")
    );
    // These commands launch an executable, not a package script. Its static
    // PORT environment survives; explicit port flags were resolved above.
    // Keep `run exec` on the alias path so a script named exec still works.
    if (
      ["exec", "dlx"].includes(positional[0]) ||
      (manager === "bun" && positional[0] === "x")
    ) {
      return envPort;
    }
    const script =
      positional[0] === "run" || positional[0] === "run-script"
        ? positional[1]
        : positional[0];
    return script ? resolveScript(root, script, envPort) : null;
  };

  const root = repoPath("", input.rootDirectory ?? "");
  if (root === null) return null;
  return input.devCommand
    ? resolveCommand(root, input.devCommand, null)
    : resolveScript(root, "dev", null);
}
