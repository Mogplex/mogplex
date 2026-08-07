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
          CLI login has moved
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This version of the mogplex CLI uses a login flow that is no longer
          supported. Update the CLI, then run{" "}
          <code className="font-mono">mogplex login</code> again.
        </p>
        <p className="mt-4 font-mono text-[13px] text-muted-foreground">
          npm install -g @mogplex/cli
        </p>
      </div>
    </div>
  );
}
