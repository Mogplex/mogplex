import type { Metadata } from "next";

import { verifyUnsubscribeToken } from "@/lib/email/unsubscribe";

import { UnsubscribeConfirmForm } from "./unsubscribe-confirm-form";

export const metadata: Metadata = {
  title: "Unsubscribe — Mogplex",
  robots: { index: false, follow: false },
};

type SearchParams = {
  email?: string | string[];
  t?: string | string[];
};

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default async function UnsubscribePage({
  searchParams,
}: {
  // Next 15+ passes searchParams as a Promise. The await resolves whatever
  // it actually is at runtime — works on 14 and 15.
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const email = firstParam(params.email);
  const token = firstParam(params.t);
  const verified = verifyUnsubscribeToken(email, token);

  return (
    <main className="min-h-screen bg-background text-foreground font-mono">
      <div className="max-w-md mx-auto px-6 py-20 space-y-6">
        <h1 className="text-2xl text-primary">Unsubscribe</h1>

        {verified.ok ? (
          <UnsubscribeConfirmForm
            email={verified.email}
            token={token ?? ""}
          />
        ) : (
          <div className="space-y-3 text-sm leading-relaxed">
            <p className="text-foreground">
              This unsubscribe link isn&apos;t valid.
            </p>
            <p className="text-muted-foreground">
              The link may have been copied incorrectly, or it was generated
              under a previous signing key. If you keep getting Mogplex email
              you didn&apos;t ask for, reply to that message and we&apos;ll
              remove you manually.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
