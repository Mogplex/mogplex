"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { Button } from "@/components/ui/button";

export type RouteErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export function RouteError({ error, reset }: RouteErrorProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <div className="flex min-h-full items-center justify-center px-6 py-12">
      <div role="alert" className="w-full max-w-md space-y-4 text-center">
        <h2 className="text-sm font-medium text-foreground">Something went wrong</h2>
        {error.digest && (
          <p className="break-all font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>
        )}
        <Button onClick={reset} variant="outline" size="sm">Try again</Button>
      </div>
    </div>
  );
}
