"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAPIError } from "better-auth/api";
import { auth } from "@/lib/better-auth/server";
import { readOAuthConsent } from "@/lib/better-auth/oauth-consent";

export async function submitOAuthConsent(query: string, form: FormData) {
  const decision = form.get("decision");
  const context = await auth.$context;
  if (
    (decision !== "allow" && decision !== "deny") ||
    !(await readOAuthConsent(query, context.secret))
  )
    redirect("/oauth/consent");

  let result;
  try {
    const requestHeaders = await headers();
    result = await auth.api.oauth2Consent({
      asResponse: false,
      headers: requestHeaders,
      request: new Request(
        new URL("/api/auth/oauth2/consent", context.baseURL),
        {
          method: "POST",
          headers: requestHeaders,
        }
      ),
      body: { accept: decision === "allow", oauth_query: query },
    });
  } catch (error) {
    if (isAPIError(error)) redirect("/oauth/consent");
    throw error;
  }
  // The provider validates the signed query, session and registered callback.
  redirect(result.url);
}
