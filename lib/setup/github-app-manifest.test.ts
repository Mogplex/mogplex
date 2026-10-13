import { describe, expect, it } from "vitest";
import {
  buildGithubAppManifest,
  defaultGithubAppName,
  githubManifestFormAction,
  GITHUB_APP_NAME_MAX_LENGTH,
  validateGithubAppName,
} from "./github-app-manifest";

describe("buildGithubAppManifest", () => {
  it("should point every URL at the deployment origin", () => {
    const manifest = buildGithubAppManifest(
      "https://mogplex.acme.dev/some/path",
      "Acme Mogplex"
    );

    expect(manifest.name).toBe("Acme Mogplex");
    expect(manifest.url).toBe("https://mogplex.acme.dev");
    expect(manifest.hook_attributes.url).toBe(
      "https://mogplex.acme.dev/api/webhooks/github"
    );
    expect(manifest.redirect_url).toBe(
      "https://mogplex.acme.dev/admin/setup/github/complete"
    );
    expect(manifest.callback_urls).toEqual([
      "https://mogplex.acme.dev/api/auth/github/callback",
    ]);
    expect(manifest.setup_url).toBe(
      "https://mogplex.acme.dev/api/auth/github/callback"
    );
    expect(JSON.stringify(manifest)).not.toContain("mogplex.example.com");
  });

  it("should request the permissions Mogplex uses", () => {
    const manifest = buildGithubAppManifest("http://localhost:3000");

    expect(manifest.default_permissions).toMatchObject({
      contents: "write",
      pull_requests: "write",
      checks: "write",
      statuses: "write",
    });
  });
});

describe("githubManifestFormAction", () => {
  it("should post to the personal account by default", () => {
    expect(githubManifestFormAction("abc")).toBe(
      "https://github.com/settings/apps/new?state=abc"
    );
  });

  it("should post to an organization when one is given", () => {
    expect(githubManifestFormAction("abc", " acme-inc ")).toBe(
      "https://github.com/organizations/acme-inc/settings/apps/new?state=abc"
    );
  });

  it("should refuse an invalid organization login", () => {
    expect(githubManifestFormAction("abc", "-acme")).toBeNull();
    expect(githubManifestFormAction("abc", "acme/../evil")).toBeNull();
  });
});

describe("GitHub App names", () => {
  it("should derive a default name within GitHub's limit", () => {
    const name = defaultGithubAppName(
      "https://a-very-long-self-hosted-deployment-host.example.com"
    );

    expect(name.startsWith("Mogplex ")).toBe(true);
    expect(name.length).toBeLessThanOrEqual(GITHUB_APP_NAME_MAX_LENGTH);
  });

  it("should reject empty and overlong names", () => {
    expect(validateGithubAppName("  ")).not.toBeNull();
    expect(validateGithubAppName("x".repeat(35))).not.toBeNull();
    expect(validateGithubAppName("Mogplex Acme")).toBeNull();
  });
});
