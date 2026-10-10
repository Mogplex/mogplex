import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getProfileId } from "@/lib/auth";
import { isUuid } from "@/lib/uuid";
import { PRIVATE_NO_INDEX_ROBOTS } from "@/lib/seo";
import { resolveConnectionRecoveryBrowser } from "@/lib/slack/connection-recovery/browser";
import { connectionRecoveryPath } from "@/lib/slack/connection-recovery/presentation";

export const metadata: Metadata = { title: "Authorize connection — Mogplex", robots: PRIVATE_NO_INDEX_ROBOTS };

export default async function SlackConnectionsPage({ searchParams }: { searchParams: Promise<{ request?: string; complete?: string }> }) {
  const params = await searchParams;
  if (!params.request || !isUuid(params.request)) return <Notice title="Connection request unavailable" text="Open the connector card in Slack to start authorization." />;
  const userId = await getProfileId();
  if (!userId) redirect(`/login?next=${encodeURIComponent(connectionRecoveryPath(params.request))}`);
  const resolved = await resolveConnectionRecoveryBrowser({ requestId: params.request, userId });
  if (!resolved) return <Notice title="Connection request unavailable" text="This request is no longer available to your linked account. Reopen the connector in Slack to check your account and access." />;
  if (params.complete !== "1") redirect(resolved.authorizePath);
  return <Notice title="Return to Slack" text="Use Check access & continue in the connection dialog. Mogplex will verify access before continuing your saved request." href={resolved.slackUrl} />;
}

function Notice({ title, text, href }: { title: string; text: string; href?: string }) {
  return <main className="bg-background text-foreground min-h-dvh p-6"><div className="mx-auto mt-24 max-w-md space-y-4"><h1 className="text-lg font-semibold">{title}</h1><p className="text-muted-foreground text-sm">{text}</p>{href && <a href={href} className="text-primary inline-flex min-h-11 items-center underline">Return to Slack</a>}</div></main>;
}
