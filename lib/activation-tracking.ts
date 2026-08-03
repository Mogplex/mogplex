"use client";

import { track } from "@vercel/analytics/react";

type AllowedPropertyValue = string | number | boolean | null | undefined;
type ActivationProperties = Record<string, AllowedPropertyValue>;

export type ActivationEventName =
  | "login_started"
  | "signup_submitted"
  | "waitlist_request_submitted"
  | "github_connect_started"
  | "repo_sync_started"
  | "repo_sync_completed"
  | "repo_sync_failed"
  | "workspace_opened"
  | "preview_started"
  | "sandbox_resumed"
  | "sandbox_restarted_on_branch"
  | "preview_feedback_sent"
  | "vercel_connect_started"
  | "vercel_project_linked";

declare global {
  interface Window {
    __mogplexTrackedEvents?: Array<{
      name: ActivationEventName;
      properties?: ActivationProperties;
    }>;
  }
}

export function trackActivation(
  name: ActivationEventName,
  properties: ActivationProperties = {}
) {
  const shouldRecordForTests =
    typeof window !== "undefined" &&
    Array.isArray(window.__mogplexTrackedEvents);

  if (shouldRecordForTests) {
    const event = { name, properties };
    window.__mogplexTrackedEvents!.push(event);

    try {
      const storageKey = "mogplex-tracked-events";
      const existing = JSON.parse(
        window.sessionStorage.getItem(storageKey) || "[]"
      ) as Array<{
        name: ActivationEventName;
        properties?: ActivationProperties;
      }>;
      existing.push(event);
      window.sessionStorage.setItem(storageKey, JSON.stringify(existing));
    } catch {
      // Ignore storage issues in constrained environments.
    }
  }

  track(name, properties);
}
