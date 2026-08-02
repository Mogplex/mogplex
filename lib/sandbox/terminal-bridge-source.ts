import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Loads the in-sandbox terminal bridge runtime source so it can be written
// into the sandbox at launch. The runtime is distributed as a .mjs file in
// this repo; we resolve it through both import.meta.url (works in dev and in
// most Next.js server bundles) and a cwd-relative fallback for robustness.
type LoadTerminalBridgeSourceOptions = {
  cwd?: string;
  readTextFile?: (path: string | URL) => string;
};

const REPO_RUNTIME_PATH = "lib/sandbox/terminal-bridge-runtime.mjs";

function defaultReadTextFile(path: string | URL) {
  return readFileSync(path, "utf8");
}

export function loadTerminalBridgeSource(
  options: LoadTerminalBridgeSourceOptions = {}
) {
  const read = options.readTextFile ?? defaultReadTextFile;
  const candidates: Array<string | URL> = [
    new URL("terminal-bridge-runtime.mjs", import.meta.url),
    resolve(options.cwd ?? process.cwd(), REPO_RUNTIME_PATH),
  ];
  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      return read(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error("Failed to load terminal bridge runtime source", {
    cause: lastError,
  });
}
