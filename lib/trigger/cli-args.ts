/**
 * Trigger.dev CLI commands that accept `--api-url`. Other commands (for
 * example `update`) reject unknown options, so the URL is only added here.
 */
const API_URL_COMMANDS = new Set([
  "deploy",
  "dev",
  "env",
  "init",
  "login",
  "logout",
  "mcp",
  "mint-token",
  "preview",
  "promote",
  "report",
  "whoami",
]);

function hasApiUrlFlag(args: readonly string[]) {
  return args.some(
    (arg) => arg === "-a" || arg === "--api-url" || arg.startsWith("--api-url=")
  );
}

function parseApiUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `Invalid TRIGGER_API_URL "${value}": expected an absolute http(s) URL`
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `Invalid TRIGGER_API_URL "${value}": expected an absolute http(s) URL`
    );
  }
  return value;
}

/**
 * Builds the argument list for the Trigger.dev CLI. When `TRIGGER_API_URL`
 * points at a self-hosted Trigger.dev instance, the CLI only reads it alongside
 * `TRIGGER_ACCESS_TOKEN`; otherwise it falls back to the login profile's URL.
 * Passing `--api-url` explicitly keeps `pnpm trigger:*` aimed at the same
 * instance the app's SDK calls. An explicit `--api-url` argument wins.
 */
export function resolveTriggerCliArgs(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const args = argv.filter((arg) => arg !== "--");
  const apiUrl = env.TRIGGER_API_URL?.trim();
  const command = args[0];

  if (
    !apiUrl ||
    !command ||
    !API_URL_COMMANDS.has(command) ||
    hasApiUrlFlag(args)
  ) {
    return args;
  }

  return [command, "--api-url", parseApiUrl(apiUrl), ...args.slice(1)];
}
