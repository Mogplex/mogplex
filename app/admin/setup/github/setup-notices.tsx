import { SetupShell } from "@/components/setup/setup-shell";
import type { GithubSetupAvailability } from "@/lib/setup/setup-availability";

const NOTICES: Record<
  Exclude<GithubSetupAvailability["status"], "available">,
  { title: string; description: string }
> = {
  disabled: {
    title: "GitHub App setup is off",
    description:
      "Set MOGPLEX_SETUP_ENABLED=1 on this deployment to create its GitHub App here. Remove it again after setup.",
  },
  already_configured: {
    title: "GitHub App already configured",
    description:
      "This deployment already has GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, and GITHUB_APP_NAME. Install the App from Settings → Account.",
  },
  missing_signing_secret: {
    title: "GitHub App setup needs BETTER_AUTH_SECRET",
    description:
      "Setup signs its GitHub round trip with BETTER_AUTH_SECRET. Set it on this deployment, then reload this page.",
  },
};

/** The page shown when setup cannot create an App. */
export function GithubSetupUnavailable({
  status,
}: {
  status: Exclude<GithubSetupAvailability["status"], "available">;
}) {
  const notice = NOTICES[status];
  return <SetupShell title={notice.title} description={notice.description} />;
}
