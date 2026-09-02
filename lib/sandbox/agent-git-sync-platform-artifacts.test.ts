import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { buildAgentGitSyncScript } from "./agent-git-sync";
import {
  buildStandaloneNextConfig,
  patchNextConfigContent,
} from "./runtimes/next-config-patch";

const ORIGINAL_NEXT_CONFIG = [
  "/** @type {import('next').NextConfig} */",
  "const nextConfig = {",
  "  reactStrictMode: true,",
  "};",
  "",
  "export default nextConfig;",
  "",
].join("\n");

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function createRepoWithOrigin() {
  const root = mkdtempSync(path.join(tmpdir(), "mogplex-git-sync-"));
  const origin = path.join(root, "origin.git");
  const work = path.join(root, "work");
  mkdirSync(work);
  execFileSync("git", ["init", "--bare", "--initial-branch=main", origin]);
  git(work, "init", "--initial-branch=main");
  git(work, "config", "user.email", "test@example.com");
  git(work, "config", "user.name", "Test");
  git(work, "config", "commit.gpgsign", "false");
  git(work, "config", "core.fileMode", "true");
  writeFileSync(path.join(work, "next.config.mjs"), ORIGINAL_NEXT_CONFIG);
  mkdirSync(path.join(work, "src"));
  writeFileSync(path.join(work, "src", "app.ts"), "export const a = 1;\n");
  git(work, "add", ".");
  git(work, "commit", "-q", "-m", "init");
  git(work, "remote", "add", "origin", origin);
  git(work, "push", "-q", "-u", "origin", "main");
  return work;
}

function applySandboxBootArtifacts(work: string) {
  mkdirSync(path.join(work, ".mogplex"));
  writeFileSync(path.join(work, ".mogplex", "dev.log"), "booted\n");
  const patched = patchNextConfigContent(ORIGINAL_NEXT_CONFIG);
  if (patched.kind !== "patched") throw new Error("expected a patched config");
  writeFileSync(path.join(work, "next.config.mjs"), patched.content);
}

function runSync(work: string) {
  try {
    const stdout = execFileSync("sh", ["-c", buildAgentGitSyncScript()], {
      cwd: work,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        MOGPLEX_BASE_BRANCH: "main",
        MOGPLEX_WORKING_BRANCH: "mogplex/agent-test",
        MOGPLEX_CREATE_BRANCH: "1",
        MOGPLEX_FALLBACK_BRANCH: "",
        MOGPLEX_REQUIRE_CLEAN: "1",
      },
    });
    return { exitCode: 0, stdout, stderr: "" };
  } catch (error) {
    const failure = error as { status?: number; stderr?: string };
    return {
      exitCode: failure.status ?? 1,
      stdout: "",
      stderr: failure.stderr ?? "",
    };
  }
}

describe("agent git sync on a freshly booted sandbox", () => {
  let work: string;

  beforeEach(() => {
    work = createRepoWithOrigin();
    applySandboxBootArtifacts(work);
  });

  it("should treat platform boot artifacts as clean and sync the delivery branch", () => {
    const result = runSync(work);

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("MOGPLEX_SYNCED_BRANCH=mogplex/agent-test");
    expect(git(work, "branch", "--show-current")).toBe("mogplex/agent-test");
    expect(git(work, "status", "--porcelain")).toBe("");
    expect(readFileSync(path.join(work, "next.config.mjs"), "utf8")).toBe(
      ORIGINAL_NEXT_CONFIG
    );
    expect(
      readFileSync(path.join(work, ".mogplex", ".gitignore"), "utf8")
    ).toBe("*\n");
  });

  it("should still refuse a tree with the user's own uncommitted work", () => {
    writeFileSync(path.join(work, "src", "app.ts"), "export const a = 2;\n");

    const result = runSync(work);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("workspace is not clean");
    expect(result.stderr).toContain("src/app.ts");
    expect(result.stderr).not.toContain("next.config.mjs");
    expect(result.stderr).not.toContain(".mogplex");
  });

  it("should not revert a next.config edit that goes beyond the platform patch", () => {
    const current = readFileSync(path.join(work, "next.config.mjs"), "utf8");
    writeFileSync(
      path.join(work, "next.config.mjs"),
      current.replace("reactStrictMode: true", "reactStrictMode: false")
    );

    const result = runSync(work);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("next.config.mjs");
    expect(readFileSync(path.join(work, "next.config.mjs"), "utf8")).toContain(
      "reactStrictMode: false"
    );
  });

  it("should not revert an edit to the injected line itself even though the marker remains", () => {
    const current = readFileSync(path.join(work, "next.config.mjs"), "utf8");
    const edited = current.replace(
      '["*.vercel.run"]',
      '["*.vercel.run", "preview.example.com"]'
    );
    expect(edited).not.toBe(current);
    writeFileSync(path.join(work, "next.config.mjs"), edited);

    const result = runSync(work);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("next.config.mjs");
    expect(readFileSync(path.join(work, "next.config.mjs"), "utf8")).toBe(
      edited
    );
  });

  it("should not revert the injected line when the user also changed the file mode", () => {
    const configPath = path.join(work, "next.config.mjs");
    const patched = readFileSync(configPath, "utf8");
    chmodSync(configPath, 0o755);

    const result = runSync(work);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("next.config.mjs");
    expect(readFileSync(configPath, "utf8")).toBe(patched);
    expect(statSync(configPath).mode & 0o111).not.toBe(0);
  });

  describe("for a repo without a next.config", () => {
    beforeEach(() => {
      git(work, "checkout", "--", "next.config.mjs");
      git(work, "rm", "-q", "next.config.mjs");
      git(work, "commit", "-q", "-m", "drop config");
      git(work, "push", "-q", "origin", "main");
      writeFileSync(
        path.join(work, "next.config.mjs"),
        buildStandaloneNextConfig()
      );
    });

    it("should remove the untouched standalone next.config the platform wrote at boot", () => {
      const result = runSync(work);

      expect(result.exitCode).toBe(0);
      expect(git(work, "status", "--porcelain")).toBe("");
    });

    it("should keep a standalone next.config the user has edited and refuse the run", () => {
      const edited = buildStandaloneNextConfig().replace(
        "const nextConfig = {",
        "const nextConfig = {\n  reactStrictMode: true,"
      );
      writeFileSync(path.join(work, "next.config.mjs"), edited);

      const result = runSync(work);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("next.config.mjs");
      expect(readFileSync(path.join(work, "next.config.mjs"), "utf8")).toBe(
        edited
      );
    });
  });
});
