"use client";

import { RouteError, type RouteErrorProps } from "@/components/route-error";

export default function GlobalError({
  error,
  retry,
}: RouteErrorProps) {
  return (
    <html className="dark" lang="en">
      <body className="bg-background font-mono text-foreground">
        <div className="min-h-screen">
          <RouteError error={error} retry={retry} />
        </div>
      </body>
    </html>
  );
}
