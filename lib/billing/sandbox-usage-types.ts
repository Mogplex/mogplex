/**
 * Types and error utilities for sandbox billing.
 * @module
 */

export const SANDBOX_BALANCE_REQUIRED_SQLSTATE = "MP001";
export const SANDBOX_BALANCE_REQUIRED_MESSAGE =
  "Hosted sandbox compute requires a positive billing balance";
export const SANDBOX_BILLING_UNAVAILABLE_MESSAGE =
  "Sandbox billing is temporarily unavailable. Please try again.";

export type ActiveSandboxBillingSession = {
  id: string;
  sandbox_record_id: string;
  vercel_sandbox_id: string;
  vercel_session_id: string;
  account_id: string;
  actor_user_id: string;
  product_team_id: string | null;
  state: "open" | "closing";
  started_at: string;
  metered_through_at: string;
  close_generation: number;
  close_requested_at: string | null;
};

export type SandboxBillingCloseAttempt = {
  sessionId: string;
  closeGeneration: number;
  actorUserId: string;
  meteredThroughAt?: Date;
};

export type SandboxProviderSession = {
  sessionId: string;
  status: string;
  startedAt: Date;
  hasReliableStartedAt: boolean;
  stoppedAt: Date | null;
  updatedAt: Date;
};

export type SandboxBillingSyncResult = {
  metered: boolean;
  reason:
    | "opened"
    | "already_open"
    | "billing_disabled"
    | "allowlisted"
    | "not_platform_billed"
    | "no_billing_account";
  sessionId: string | null;
};

export type SandboxBillingRecordIdentity = {
  id: string;
  sandbox_id: string;
  billing_source?: string | null;
  actor_user_id?: string | null;
  user_id: string;
  product_team_id?: string | null;
};

export class SandboxBillingAdmissionError extends Error {
  constructor(
    message: string,
    readonly reason: "no_billing_account" | "metering_failed"
  ) {
    super(message);
    this.name = "SandboxBillingAdmissionError";
  }
}

export function sandboxBillingBalanceRequiredError(
  message = "Hosted sandbox compute requires a positive balance"
) {
  return Object.assign(new Error(message), {
    code: SANDBOX_BALANCE_REQUIRED_SQLSTATE,
  });
}

export function isSandboxBillingBalanceRequiredError(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === SANDBOX_BALANCE_REQUIRED_SQLSTATE
  );
}

export function presentSandboxBillingAdmissionError(error: unknown) {
  if (!(error instanceof SandboxBillingAdmissionError)) return null;
  return error.reason === "no_billing_account"
    ? { status: 402, message: SANDBOX_BALANCE_REQUIRED_MESSAGE }
    : { status: 503, message: SANDBOX_BILLING_UNAVAILABLE_MESSAGE };
}
