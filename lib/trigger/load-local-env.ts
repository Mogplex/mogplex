import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_ENV_FILES = [".env", ".env.local"] as const;

export function resolveTriggerCliEnvFiles(
  extraFilesRaw: string | null | undefined,
  defaults: readonly string[] = DEFAULT_ENV_FILES
) {
  const extraFiles = (extraFilesRaw ?? "")
    .split(",")
    .map((fileName) => fileName.trim())
    .filter(Boolean);

  return [...defaults, ...extraFiles];
}

function stripMatchingQuotes(value: string) {
  if (value.length < 2) {
    return value;
  }

  const first = value[0];
  const last = value.at(-1);
  if ((first === '"' || first === "'") && first === last) {
    const inner = value.slice(1, -1);
    return first === '"'
      ? inner.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\"/g, '"')
      : inner;
  }

  return value.replace(/\s+#.*$/, "").trim();
}

function parseEnvAssignment(line: string) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const normalized = trimmed.startsWith("export ")
    ? trimmed.slice(7).trim()
    : trimmed;
  const separatorIndex = normalized.indexOf("=");
  if (separatorIndex <= 0) {
    return null;
  }

  const key = normalized.slice(0, separatorIndex).trim();
  if (!/^[A-Z_a-z]\w*$/.test(key)) {
    return null;
  }

  const rawValue = normalized.slice(separatorIndex + 1).trim();
  return [key, stripMatchingQuotes(rawValue)] as const;
}

export function loadLocalEnvFiles(
  rootDir = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
  fileNames: readonly string[] = DEFAULT_ENV_FILES
) {
  const originalKeys = new Set(Object.keys(env));
  const parsedValues = new Map<string, string>();
  const loadedFiles: string[] = [];

  for (const fileName of fileNames) {
    const filePath = resolve(rootDir, fileName);
    if (!existsSync(filePath)) {
      continue;
    }

    loadedFiles.push(filePath);

    const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const assignment = parseEnvAssignment(line);
      if (!assignment) {
        continue;
      }

      const [key, value] = assignment;
      if (originalKeys.has(key)) {
        continue;
      }

      parsedValues.set(key, value);
    }
  }

  for (const [key, value] of parsedValues) {
    env[key] = value;
  }

  return loadedFiles;
}
