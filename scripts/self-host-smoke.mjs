// Self-host smoke test. Boots docker-compose.yml against a fresh database and
// checks that a self-hoster's first `docker compose up` works:
//
//   1. migrate applies the baseline and every migration, then exits 0
//   2. app answers /api/health with the database "ok"
//   3. cron is running
//   4. migrate exits 0 again on the migrated database (idempotent upgrades)
//
// It writes a throwaway .env, so it refuses to run when one exists. The
// self-host-smoke workflow runs it against an image built from the PR:
//
//   docker build -t mogplex:local .
//   MOGPLEX_IMAGE=mogplex MOGPLEX_VERSION=local node scripts/self-host-smoke.mjs
//
// Without MOGPLEX_IMAGE / MOGPLEX_VERSION it pulls the published image.
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, rmSync, writeFileSync } from "node:fs";

const HEALTH_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 2000;
const PROJECT = process.env.COMPOSE_PROJECT_NAME || "mogplex-smoke";
const ENV_FILE = ".env";

const compose = (...args) => [
  "compose",
  "--project-name",
  PROJECT,
  "-f",
  "docker-compose.yml",
  ...args,
];

function docker(args, options = {}) {
  const stdout = execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    ...options,
  });
  // stdout is null when the caller inherits stdio.
  return (stdout ?? "").trim();
}

function dockerStatus(args) {
  return spawnSync("docker", args, { encoding: "utf8" });
}

const log = (message) => process.stdout.write(`${message}\n`);

function step(message) {
  log(`\n==> ${message}`);
}

function writeEnvFile() {
  const secret = () => randomBytes(32).toString("hex");
  writeFileSync(
    ENV_FILE,
    [
      // The host port is irrelevant to the checks; avoid clashing with a
      // local dev server.
      "MOGPLEX_PORT=3999",
      "APP_URL=http://localhost:3999",
      `BETTER_AUTH_SECRET=${secret()}`,
      `CRON_SECRET=${secret()}`,
      `INTERNAL_API_SECRET=${secret()}`,
      `CONNECTIONS_ENCRYPTION_KEY=${secret()}`,
      `POSTGRES_PASSWORD=${secret()}`,
      "MOGPLEX_SELF_HOSTED=1",
      "",
    ].join("\n")
  );
}

async function waitForHealthyApp() {
  const probe = [
    "fetch('http://127.0.0.1:3000/api/health')",
    ".then(async (r) => { console.log(await r.text()); process.exit(r.ok ? 0 : 1); })",
    ".catch(() => process.exit(1))",
  ].join("");
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let last = "";
  while (Date.now() < deadline) {
    const result = dockerStatus(
      compose("exec", "-T", "app", "node", "-e", probe)
    );
    last = result.stdout.trim();
    if (result.status === 0) return JSON.parse(last);
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(
    `app was not healthy within ${HEALTH_TIMEOUT_MS / 1000}s; last response: ${last || "none"}`
  );
}

function migrateExitCode() {
  const id = docker(compose("ps", "--all", "--quiet", "migrate"));
  if (!id) throw new Error("migrate container not found");
  return Number(docker(["inspect", "--format", "{{.State.ExitCode}}", id]));
}

async function main() {
  if (existsSync(ENV_FILE)) {
    throw new Error(
      "refusing to overwrite .env; run the smoke test from a clean checkout"
    );
  }
  writeEnvFile();

  let passed = false;
  try {
    step("docker compose up");
    const pull = process.env.MOGPLEX_VERSION === "local" ? "never" : "missing";
    docker(compose("up", "--detach", "--pull", pull), { stdio: "inherit" });

    step("waiting for /api/health");
    const health = await waitForHealthyApp();
    if (health.checks?.database !== "ok") {
      throw new Error(`database check is ${health.checks?.database}`);
    }
    log(JSON.stringify(health));

    step("migrate exited cleanly");
    const firstExit = migrateExitCode();
    if (firstExit !== 0) throw new Error(`migrate exited ${firstExit}`);

    step("cron is running");
    const cron = docker(
      compose("ps", "--status", "running", "--quiet", "cron")
    );
    if (!cron) throw new Error("cron is not running");

    step("migrate is idempotent");
    docker(compose("run", "--rm", "--no-deps", "migrate"), {
      stdio: "inherit",
    });

    passed = true;
    log("\nself-host smoke test passed");
  } finally {
    if (!passed) {
      spawnSync("docker", compose("logs", "--no-color", "--tail", "200"), {
        stdio: "inherit",
      });
    }
    dockerStatus(compose("down", "--volumes", "--remove-orphans"));
    rmSync(ENV_FILE, { force: true });
  }
}

// Same entry pattern as self-host-cron.mjs.
// eslint-disable-next-line unicorn/prefer-top-level-await
void (async () => {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `\nself-host smoke test failed: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
})();
