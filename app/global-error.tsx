"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html className="dark" lang="en">
      <body className="bg-background font-mono text-foreground">
        <div className="flex min-h-screen items-center justify-center px-6">
          <div className="w-full max-w-md space-y-4 text-center">
            <div className="text-sm text-secondary-foreground">
              Something went wrong
            </div>
            <div className="text-xs break-all text-muted-foreground">
              {error.message || "An unexpected error occurred"}
            </div>
            {error.digest && (
              <div className="text-[10px] text-muted-foreground/70">
                digest: {error.digest}
              </div>
            )}
            <button
              onClick={reset}
              className="rounded border border-border px-4 py-2 text-xs transition-colors hover:bg-secondary"
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
