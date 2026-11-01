import { GithubHttpError } from "@/lib/github-app";

/** Revocation is absence of a grant; provider outages remain verification errors. */
export async function ignoreRevokedGithubInstallation<T>(
  operation: Promise<T>
): Promise<T | null> {
  try {
    return await operation;
  } catch (error) {
    if (
      error instanceof GithubHttpError &&
      error.status === 403 &&
      /rate[\s-]*limit/i.test(error.responseBody)
    )
      throw error;
    if (
      error instanceof GithubHttpError &&
      [401, 403, 404].includes(error.status)
    ) {
      console.warn("[github-installations] authorization unavailable", {
        status: error.status,
      });
      return null;
    }
    throw error;
  }
}
