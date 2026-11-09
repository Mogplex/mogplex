import { expect, it } from "vitest";
import { getGithubInstallToast } from "./github-install-outcome";

const toastFor = (query: string) =>
  getGithubInstallToast(new URLSearchParams(query));

it("should confirm a connection and say when repositories are still syncing", () => {
  expect(toastFor("github=connected")).toMatchObject({
    title: "GitHub connected",
    variant: "success",
  });
  expect(toastFor("github=connected&repo_sync=failed")).toMatchObject({
    title: "GitHub connected",
    variant: "info",
  });
});

it("should explain that only an owner can connect an organization", () => {
  const toast = toastFor(
    "github=error&reason=github_installation_owner_required"
  );
  expect(toast?.title).toBe("Only an owner can connect this account");
  expect(toast?.description).toContain("shared with your Mogplex team");
});

it("should fall back to a generic failure for an unknown reason", () => {
  expect(toastFor("github=error&reason=github_token_store")).toMatchObject({
    title: "GitHub connection failed",
    variant: "destructive",
  });
  expect(toastFor("github=error")?.title).toBe("GitHub connection failed");
});

it("should stay silent when the URL carries no GitHub outcome", () => {
  expect(toastFor("")).toBeNull();
  expect(toastFor("github=something-else")).toBeNull();
});
