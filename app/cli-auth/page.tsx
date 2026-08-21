import type { Metadata } from "next";
import { PRIVATE_NO_INDEX_ROBOTS } from "@/lib/seo";

export const metadata: Metadata = {
  title: "CLI authorization — Mogplex",
  robots: PRIVATE_NO_INDEX_ROBOTS,
};

/**
 * /cli-auth — retired PAT-handoff flow.
 *
 * CLI login is OAuth (authorization-code + PKCE) as of August 2026: the CLI
 * drives /api/auth/mcp/authorize directly and never links here. This stub
 * only catches pre-OAuth CLI builds so they get an upgrade prompt instead
 * of a broken consent screen.
 */
export default function CliAuthPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="max-w-md text-center">
        <h1 className="text-lg font-semibold text-foreground">
          Update Mogplex to sign in
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Update Mogplex before sign-in. Run:
        </p>
        <pre className="mt-4 overflow-x-auto font-mono text-[13px] text-muted-foreground">
          <code>mogplex --update</code>
        </pre>
        <p className="mt-4 text-sm text-muted-foreground">
          If this command fails, install the current version:
        </p>
        <pre className="mt-4 overflow-x-auto font-mono text-[13px] text-muted-foreground">
          <code>curl -fsSL https://install.mogplex.com/install.sh | sh</code>
        </pre>
        <p className="mt-4 text-sm text-muted-foreground">
          Start <code className="font-mono">mogplex</code> again. Complete
          sign-in in the browser.
        </p>
      </div>
    </div>
  );
}
