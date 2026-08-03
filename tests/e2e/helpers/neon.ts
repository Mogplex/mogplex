// Shared resolution of the Neon connection string for the real-database auth
// specs. Playwright specs don't inherit Next's .env.local loading, so local
// runs read the value straight from the file the dev server uses; CI provides
// DATABASE_URL through the workflow env.
import fs from "node:fs";
import path from "node:path";

function readEnvValue(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  try {
    // Playwright runs specs with the repo root as cwd (the config directory).
    const content = fs.readFileSync(
      path.join(process.cwd(), ".env.local"),
      "utf8"
    );
    const match = content.match(new RegExp(`^${name}=(.*)$`, "m"));
    return match?.[1]?.trim().replace(/^["']|["']$/g, "") || undefined;
  } catch {
    return undefined;
  }
}

export function resolveNeonDatabaseUrl(): string | undefined {
  return readEnvValue("DATABASE_URL") ?? readEnvValue("mogplex_DATABASE_URL");
}
