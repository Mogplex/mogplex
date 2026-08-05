import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  validateCliCallback,
  type CallbackValidationResult,
} from "@/lib/cli-auth/callback-validate";
import {
  buildCliAuthReturnUrl,
  firstOf,
  resolveCliTokenName,
} from "@/lib/cli-auth/page-params";
import { ConsentScreen } from "@/components/cli-auth/ConsentScreen";
import { PRIVATE_NO_INDEX_ROBOTS } from "@/lib/seo";

export const metadata: Metadata = {
  title: "CLI authorization — Mogplex",
  robots: PRIVATE_NO_INDEX_ROBOTS,
};

/**
 * /cli-auth - Browser-based CLI authentication page.
 *
 * The CLI opens this page in the browser. User sees a consent screen,
 * clicks approve, and the page generates a PAT and POSTs it back to
 * a localhost callback the CLI is listening on.
 */
export default async function CliAuthPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  // Build return URL with current params for after login
  const returnUrl = buildCliAuthReturnUrl(params);

  // Auth check: redirect to login if no session
  let user: { email?: string | null } | null;
  if (process.env.MOGPLEX_DATA_BACKEND === "neon") {
    const { auth } = await import("@/lib/better-auth/server");
    const session = await auth.api.getSession({ headers: await headers() });
    user = session?.user ?? null;
  } else {
    const supabase = await createClient();
    const result = await supabase.auth.getUser();
    user = result.data.user;
  }

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(returnUrl)}`);
  }

  // Validate callback URL and nonce
  const callbackRaw = firstOf(params.callback);
  const nonceRaw = firstOf(params.nonce);
  const nameRaw = firstOf(params.name);

  const validation: CallbackValidationResult = validateCliCallback({
    callback: callbackRaw,
    nonce: nonceRaw,
  });

  // Error page for invalid callback
  if ("error" in validation) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background p-6">
        <div className="max-w-md text-center">
          <h1 className="text-lg font-semibold text-foreground">
            Invalid Request
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {validation.error}
          </p>
          <p className="mt-4 text-[11px] text-muted-foreground">
            This page should be opened by the mogplex CLI.
          </p>
        </div>
      </div>
    );
  }

  // Determine token name - use provided name or generate default
  const tokenName = resolveCliTokenName(nameRaw);

  const userEmail = user.email ?? "Unknown";

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <ConsentScreen
        tokenName={tokenName}
        userEmail={userEmail}
        callbackUrl={validation.url}
        nonce={validation.nonce}
      />
    </div>
  );
}
