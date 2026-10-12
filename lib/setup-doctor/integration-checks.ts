import crypto from "node:crypto";
import { normalizePrivateKey } from "@/lib/github-app";
import {
  configured,
  DOCS,
  type DoctorCheckResult,
  type DoctorEnv,
  missing,
} from "./types";

/** trigger.config.ts falls back to this hosted ref when TRIGGER_PROJECT_REF is unset. */
export const HOSTED_TRIGGER_PROJECT_REF = "proj_ssjnkodxhnnukrwiymaf";

const GITHUB_APP_VARS = [
  "GITHUB_APP_ID",
  "GITHUB_APP_NAME",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_WEBHOOK_SECRET",
] as const;

/** Signs a throwaway payload with the App key, as createGithubAppJwt does. */
function canSignWithPrivateKey(rawKey: string): boolean {
  try {
    const key = crypto.createPrivateKey(normalizePrivateKey(rawKey.trim()));
    crypto.createSign("RSA-SHA256").update("mogplex-doctor").end().sign(key);
    return true;
  } catch {
    return false;
  }
}

export function checkGithubApp(env: DoctorEnv): DoctorCheckResult {
  const result = { id: "github", docsUrl: DOCS.githubApp };
  const absent = missing(env, GITHUB_APP_VARS);
  if (absent.length === GITHUB_APP_VARS.length) {
    return {
      ...result,
      status: "warn",
      summary:
        "GitHub App not configured: no repo access, webhooks, or PR reviews",
    };
  }
  if (absent.length > 0) {
    return {
      ...result,
      status: "fail",
      summary: `Missing ${absent.join(", ")}`,
    };
  }
  if (!canSignWithPrivateKey(env.GITHUB_APP_PRIVATE_KEY ?? "")) {
    return {
      ...result,
      status: "fail",
      summary: "GITHUB_APP_PRIVATE_KEY is not a usable PEM private key",
    };
  }
  const oauthAbsent = missing(env, [
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
  ]);
  if (oauthAbsent.length > 0) {
    return {
      ...result,
      status: "warn",
      summary: `GitHub App OK; ${oauthAbsent.join(", ")} missing, so repo listing and reauthorization fail`,
    };
  }
  return {
    ...result,
    status: "pass",
    summary: "GitHub App and OAuth app configured",
  };
}

export function checkTrigger(env: DoctorEnv): DoctorCheckResult {
  const result = { id: "trigger", docsUrl: DOCS.backgroundJobs };
  const hasCredential =
    configured(env, "TRIGGER_SECRET_KEY") ||
    configured(env, "TRIGGER_ACCESS_TOKEN");
  const ref = env.TRIGGER_PROJECT_REF?.trim();
  if (!hasCredential && !ref) {
    return {
      ...result,
      status: "warn",
      summary:
        "Trigger.dev not configured: automations and Slack runs do not start",
    };
  }
  if (!hasCredential) {
    return {
      ...result,
      status: "fail",
      summary: "TRIGGER_SECRET_KEY is not set",
    };
  }
  if (!ref) {
    return {
      ...result,
      status: "fail",
      summary:
        "TRIGGER_PROJECT_REF is not set; deploys would target the hosted project",
    };
  }
  if (ref === HOSTED_TRIGGER_PROJECT_REF) {
    return {
      ...result,
      status: "warn",
      summary:
        "TRIGGER_PROJECT_REF is the hosted Mogplex project; self-hosted installs need their own",
    };
  }
  return { ...result, status: "pass", summary: `Trigger.dev project ${ref}` };
}

export function sandboxProjectId(env: DoctorEnv): string | undefined {
  return (
    env.VERCEL_PROJECT_ID?.trim() ||
    env.PLATFORM_VERCEL_PROJECT_ID?.trim() ||
    undefined
  );
}

export function checkSandboxes(env: DoctorEnv): DoctorCheckResult {
  const result = { id: "sandboxes", docsUrl: DOCS.sandboxesAndModels };
  const hasToken = configured(env, "PLATFORM_VERCEL_TOKEN");
  const projectId = sandboxProjectId(env);
  if (!(hasToken || projectId)) {
    return {
      ...result,
      status: "warn",
      summary: "Vercel Sandbox not configured: agents cannot run code",
    };
  }
  if (!hasToken) {
    return {
      ...result,
      status: "fail",
      summary: "PLATFORM_VERCEL_TOKEN is not set",
    };
  }
  if (!projectId) {
    return {
      ...result,
      status: "fail",
      summary: "VERCEL_PROJECT_ID or PLATFORM_VERCEL_PROJECT_ID is not set",
    };
  }
  return {
    ...result,
    status: "pass",
    summary: "Vercel Sandbox credentials set",
  };
}
