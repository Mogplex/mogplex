"use client";

import { useState, type ReactNode } from "react";
import * as Sentry from "@sentry/nextjs";

/** Rendered only by the agents page when the server's PLAYWRIGHT flag is on. */
export function RouteErrorFixture({ children }: { children: ReactNode }) {
  const [recovered] = useState(() => {
    if (typeof window === "undefined") return false;
    Sentry.init({
      dsn: "https://fixture@example.invalid/1",
      integrations: [],
      transport: () => ({
        send: async (envelope: unknown) => {
          window.dispatchEvent(new CustomEvent("mogplex-e2e-sentry", { detail: envelope }));
          return { statusCode: 200 };
        },
        flush: async () => true,
      }),
    });
    return window.sessionStorage.getItem("mogplex-e2e-route-recovered") === "1";
  });
  if (typeof window !== "undefined" && !recovered) {
    throw Object.assign(new Error("Private database fixture failure"), { digest: "route-fixture-422" });
  }
  return children;
}
