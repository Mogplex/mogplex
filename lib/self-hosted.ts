/**
 * Self-host mode: `MOGPLEX_SELF_HOSTED=1` grants platform AI and sandbox
 * access to every signed-in user, so a deployment without Stripe billing can
 * run agents. `MOGPLEX_SELF_HOSTED_ALLOWED_EMAIL_DOMAINS` narrows the grant to
 * matching email domains.
 *
 * The mode never activates while `STRIPE_SECRET_KEY` is set: a deployment with
 * hosted billing configured must keep billing-backed access, so a stray flag
 * cannot hand out free usage. Trigger.dev workers never hold the Stripe key, so
 * the mode also refuses in any process of the hosted Mogplex project: the
 * managed run controller sets `TRIGGER_PROJECT_REF` to the running project in
 * every task process, overriding synced env.
 */

import { HOSTED_TRIGGER_PROJECT_REF } from "@/lib/trigger/project-ref";

export type SelfHostedMode = {
  active: boolean;
  /** Empty when every signed-in user qualifies. */
  allowedEmailDomains: ReadonlySet<string>;
  /** Set when the flag is on but refused. */
  refusedReason: "stripe_configured" | "hosted_deployment" | null;
};

const ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);

function isFlagEnabled(value: string | undefined): boolean {
  return ENABLED_VALUES.has((value ?? "").trim().toLowerCase());
}

function parseEmailDomains(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase().replace(/^@/, ""))
      .filter(Boolean)
  );
}

/** Resolves self-host mode from an environment without side effects. */
export function resolveSelfHostedMode(
  env: Readonly<Record<string, string | undefined>>
): SelfHostedMode {
  const allowedEmailDomains = parseEmailDomains(
    env.MOGPLEX_SELF_HOSTED_ALLOWED_EMAIL_DOMAINS
  );
  if (!isFlagEnabled(env.MOGPLEX_SELF_HOSTED)) {
    return { active: false, allowedEmailDomains, refusedReason: null };
  }
  if (env.TRIGGER_PROJECT_REF?.trim() === HOSTED_TRIGGER_PROJECT_REF) {
    return {
      active: false,
      allowedEmailDomains,
      refusedReason: "hosted_deployment",
    };
  }
  if (env.STRIPE_SECRET_KEY?.trim()) {
    return {
      active: false,
      allowedEmailDomains,
      refusedReason: "stripe_configured",
    };
  }
  return { active: true, allowedEmailDomains, refusedReason: null };
}

let processMode: SelfHostedMode | null = null;

/** Self-host mode for this process. Logs once if the flag is refused. */
export function getSelfHostedMode(): SelfHostedMode {
  if (processMode) return processMode;
  processMode = resolveSelfHostedMode(process.env);
  if (processMode.refusedReason === "stripe_configured") {
    console.warn(
      "[self-hosted] MOGPLEX_SELF_HOSTED is set but STRIPE_SECRET_KEY is configured; self-host mode stays off and billing-backed access applies."
    );
  } else if (processMode.refusedReason === "hosted_deployment") {
    console.warn(
      "[self-hosted] MOGPLEX_SELF_HOSTED is set in the hosted Mogplex Trigger.dev project; self-host mode stays off and billing-backed access applies."
    );
  }
  return processMode;
}

export function isSelfHostedMode(): boolean {
  return getSelfHostedMode().active;
}

/** Whether self-host mode grants platform access to a user with this email. */
export function selfHostedModeGrants(
  mode: SelfHostedMode,
  email: string | null | undefined
): boolean {
  if (!mode.active) return false;
  if (mode.allowedEmailDomains.size === 0) return true;
  const normalized = email?.trim().toLowerCase() ?? "";
  const atIndex = normalized.lastIndexOf("@");
  if (atIndex === -1 || atIndex === normalized.length - 1) return false;
  return mode.allowedEmailDomains.has(normalized.slice(atIndex + 1));
}
