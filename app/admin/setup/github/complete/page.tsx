import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CopyableEnvBlock } from "@/components/setup/copyable-env-block";
import { SetupShell } from "@/components/setup/setup-shell";
import { getUserId } from "@/lib/auth";
import { PRIVATE_NO_INDEX_ROBOTS } from "@/lib/seo";
import {
  exchangeGithubManifestCode,
  formatGithubAppEnvBlock,
  type GithubManifestConversionResult,
} from "@/lib/setup/github-manifest-conversion";
import { verifyGithubManifestState } from "@/lib/setup/github-manifest-state";
import { getGithubSetupAvailability } from "@/lib/setup/setup-availability";
import { GithubSetupUnavailable } from "../setup-notices";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "GitHub App created — Mogplex",
  robots: PRIVATE_NO_INDEX_ROBOTS,
  referrer: "no-referrer",
};

const OAUTH_APP_DOCS =
  "https://docs.mogplex.com/self-hosting/github-app#3-create-the-github-oauth-app";

const FAILURES: Record<
  Extract<GithubManifestConversionResult, { ok: false }>["reason"],
  string
> = {
  invalid_code: "GitHub did not return a valid setup code. Start setup again.",
  expired_code:
    "This setup code was already used or has expired. If GitHub created the App, generate a private key on its settings page. Otherwise, start setup again.",
  github_error: "GitHub could not be reached. Reload this page to try again.",
  invalid_response:
    "GitHub returned an unexpected response. Check the App on GitHub, or start setup again.",
};

type CompletePageProps = {
  searchParams: Promise<{ code?: string; state?: string }>;
};

export default async function GithubSetupCompletePage({
  searchParams,
}: CompletePageProps) {
  const userId = await getUserId();
  if (!userId) redirect("/login?next=%2Fadmin%2Fsetup%2Fgithub");

  const availability = getGithubSetupAvailability();
  if (availability.status !== "available") {
    return <GithubSetupUnavailable status={availability.status} />;
  }

  const { code, state } = await searchParams;
  if (!verifyGithubManifestState(state, userId, availability.signingSecret)) {
    return (
      <SetupShell
        title="Setup link expired"
        description="This GitHub setup link has expired or was started by another session. Start setup again."
      >
        <Link className="text-sm underline" href="/admin/setup/github">
          Start GitHub App setup
        </Link>
      </SetupShell>
    );
  }

  const result = await exchangeGithubManifestCode(code);
  if (!result.ok) {
    return (
      <SetupShell
        title="GitHub App setup failed"
        description={FAILURES[result.reason]}
      />
    );
  }

  return (
    <SetupShell
      title={`GitHub App "${result.app.name}" created`}
      description="Copy these values into your environment now. Mogplex does not store them, and this page cannot show them again."
    >
      <CopyableEnvBlock
        label="GitHub App environment variables"
        value={formatGithubAppEnvBlock(result.app)}
      />
      <ol className="text-muted-foreground list-decimal space-y-2 pl-5 text-sm">
        <li>
          Add the values to your deployment, and to your Trigger.dev
          environment.
        </li>
        <li>
          Repository import also needs GITHUB_CLIENT_ID and
          GITHUB_CLIENT_SECRET from a classic GitHub OAuth App, not this App.{" "}
          <a className="underline" href={OAUTH_APP_DOCS}>
            Create the OAuth App
          </a>
          .
        </li>
        <li>Redeploy, then install the App from Settings → Account.</li>
      </ol>
      <a className="text-sm underline" href={result.app.htmlUrl}>
        Open the App on GitHub
      </a>
    </SetupShell>
  );
}
