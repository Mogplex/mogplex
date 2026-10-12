import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { GithubManifestForm } from "@/components/setup/github-manifest-form";
import { SetupShell } from "@/components/setup/setup-shell";
import { getUserId } from "@/lib/auth";
import { PRIVATE_NO_INDEX_ROBOTS } from "@/lib/seo";
import {
  buildGithubAppManifest,
  defaultGithubAppName,
} from "@/lib/setup/github-app-manifest";
import { signGithubManifestState } from "@/lib/setup/github-manifest-state";
import { getGithubSetupAvailability } from "@/lib/setup/setup-availability";
import { resolveSetupOrigin } from "@/lib/setup/setup-origin";
import { GithubSetupUnavailable } from "./setup-notices";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "GitHub App setup — Mogplex",
  robots: PRIVATE_NO_INDEX_ROBOTS,
};

export default async function GithubSetupPage() {
  const userId = await getUserId();
  if (!userId) redirect("/login?next=%2Fadmin%2Fsetup%2Fgithub");

  const availability = getGithubSetupAvailability();
  if (availability.status !== "available") {
    return <GithubSetupUnavailable status={availability.status} />;
  }

  const origin = resolveSetupOrigin(await headers());
  if (!origin) {
    return (
      <SetupShell
        title="Set the app URL first"
        description="Set NEXT_PUBLIC_APP_URL to this deployment's public URL, so GitHub sends webhooks and callbacks to the right place."
      />
    );
  }

  return (
    <SetupShell
      title="Create the GitHub App"
      description={`GitHub creates an App with the permissions, events, and callback URLs this deployment needs, and sends its webhooks to ${origin}. You confirm the App on GitHub, then copy its credentials into your environment.`}
    >
      <GithubManifestForm
        manifest={buildGithubAppManifest(origin)}
        state={signGithubManifestState(userId, availability.signingSecret)}
        defaultName={defaultGithubAppName(origin)}
      />
    </SetupShell>
  );
}
