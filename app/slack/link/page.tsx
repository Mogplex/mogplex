import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getProfileId } from "@/lib/auth";
import { PRIVATE_NO_INDEX_ROBOTS } from "@/lib/seo";
import { consumeSlackUserLinkToken } from "@/lib/slack/installations";

export const metadata: Metadata = {
  title: "Slack account link — Mogplex",
  robots: PRIVATE_NO_INDEX_ROBOTS,
};

type SlackLinkPageProps = {
  searchParams: Promise<{ token?: string }>;
};

// Matches crypto.randomBytes(32).toString("base64url"): 43 chars, no padding.
const SLACK_LINK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isValidSlackLinkToken(token: string) {
  return SLACK_LINK_TOKEN_PATTERN.test(token);
}

export function buildLoginRedirect(token: string) {
  return `/login?next=${encodeURIComponent(`/slack/link?token=${encodeURIComponent(token)}`)}`;
}

function SlackLinkNotice({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <main className="bg-background text-foreground min-h-dvh p-6">
      <div className="mx-auto mt-24 max-w-md space-y-2">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
    </main>
  );
}

export default async function SlackLinkPage({
  searchParams,
}: SlackLinkPageProps) {
  const { token = "" } = await searchParams;
  if (!isValidSlackLinkToken(token)) {
    const description =
      token.length === 0
        ? "This Slack account link is missing its token. Return to Slack and ask Mogplex for a fresh link."
        : "This Slack account link is not valid. Return to Slack and ask Mogplex for a fresh link.";
    return (
      <SlackLinkNotice
        title="Slack link unavailable"
        description={description}
      />
    );
  }

  const userId = await getProfileId();
  if (!userId) redirect(buildLoginRedirect(token));

  let mapping;
  try {
    mapping = await consumeSlackUserLinkToken({
      token,
      mogplexUserId: userId,
    });
  } catch (error) {
    console.error("[slack-link] failed to consume Slack link token", error);
    return (
      <SlackLinkNotice
        title="Slack link unavailable"
        description="Mogplex could not finish linking Slack right now. Return to Slack and try the link again."
      />
    );
  }

  if (!mapping) {
    return (
      <SlackLinkNotice
        title="Slack link expired"
        description="This Slack account link is no longer valid. Return to Slack and ask Mogplex for a new one."
      />
    );
  }

  // TODO(#557 commit 3): resolve scope from x-mogplex-scope-* headers and use
  // scopedHref(scope, "/settings?tab=connections&slack=linked"). For now, bounce
  // through root so middleware can route to the user's personal slug.
  redirect("/?tab=connections&slack=linked");
}
