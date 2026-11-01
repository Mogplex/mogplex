import type { GithubInstallation } from "@/lib/github-app";

/** Only the account owner may attach an installation's full repository grant. */
export async function verifyGithubInstallationOwner(
  installation: GithubInstallation,
  identityToken: string,
  request: typeof fetch = fetch
): Promise<boolean> {
  const owner = installation.account?.login;
  const kind = installation.account?.type;
  if (
    !owner ||
    !identityToken ||
    !["User", "Organization"].includes(kind ?? "")
  )
    return false;
  const read = async (
    path: string
  ): Promise<Record<string, unknown> | null> => {
    const response = await request(`https://api.github.com${path}`, {
      headers: {
        Authorization: `Bearer ${identityToken}`,
        Accept: "application/vnd.github+json",
      },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if ([401, 403, 404].includes(response.status)) return null;
    if (!response.ok)
      throw new Error("GitHub installation ownership could not be verified");
    const body: unknown = await response.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  };
  const identity = await read("/user");
  if (typeof identity?.login !== "string") return false;
  if (kind === "User")
    return identity.login.toLowerCase() === owner.toLowerCase();
  // Ordinary membership does not authorize access to an org installation's
  // full repository set. Team members use repositories already shared to them.
  const membership = await read(
    `/user/memberships/orgs/${encodeURIComponent(owner)}`
  );
  return membership?.state === "active" && membership.role === "admin";
}
