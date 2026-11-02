import { z } from "zod";
import { shellQuote } from "@/lib/sandbox/client-shell";
import { isSafeRepoPath } from "@/lib/sandbox/changes";
import { REPOSITORY_CHECK_LOCKFILES } from "./plan";

export const repositoryCheckProbeSchema = z.object({
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  manifest: z.object({
    available: z.boolean(),
    packageManager: z.unknown().optional(),
    scripts: z.record(z.string(), z.string()),
    lockfiles: z.array(z.string()),
  }),
});
export type RepositoryCheckProbe = z.infer<typeof repositoryCheckProbeSchema>;

/** Hash working source rather than HEAD, so committing verified contents does
 * not invalidate results. Explicitly edited ignored files participate too.
 * File bytes stay in the sandbox; only a digest and script availability leave. */
export function buildCheckProbeCommand(paths: string[] = []) {
  if (!paths.every(isSafeRepoPath)) throw new Error("Invalid workspace path.");
  const script = `
const fs = require("node:fs");
const cp = require("node:child_process");
const crypto = require("node:crypto");
(async () => {
  const names = cp.execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).split("\\0").filter(Boolean);
  const paths = [...new Set([...names, ...${JSON.stringify(paths)}])].sort();
  const hash = crypto.createHash("sha256");
  for (const path of paths) {
    let stat;
    try { stat = fs.lstatSync(path); }
    catch (error) { if (error.code === "ENOENT") continue; throw error; }
    if (stat.isSymbolicLink()) {
      hash.update(JSON.stringify([path, "symlink", fs.readlinkSync(path)]));
    } else if (stat.isFile()) {
      hash.update(JSON.stringify([path, "file", stat.mode & 0o777, stat.size]));
      hash.update("\\0");
      for await (const chunk of fs.createReadStream(path)) hash.update(chunk);
    }
    hash.update("\\0");
  }
  const available = fs.existsSync("package.json");
  const pkg = available ? JSON.parse(fs.readFileSync("package.json", "utf8")) : {};
  const scripts = Object.fromEntries(Object.entries(pkg.scripts || {}).filter(([, value]) => typeof value === "string" && value.trim()).map(([name]) => [name, "defined"]));
  console.log(JSON.stringify({revision: hash.digest("hex"), manifest: {
    available,
    packageManager: pkg.packageManager,
    scripts,
    lockfiles: ${JSON.stringify(REPOSITORY_CHECK_LOCKFILES)}.filter(path => fs.existsSync(path))
  }}));
})().catch(() => { console.error("Could not inspect the workspace revision."); process.exitCode = 1; });
`;
  return `node --input-type=commonjs -e ${shellQuote(script)}`;
}
