import { NextResponse } from "next/server";
import type { SandboxKeyRestrictedError } from "@/lib/sandbox/direct-execution-user";
import type { SandboxCapabilityDeniedError } from "@/lib/sandbox/get-user-credentials";

type SandboxAccessDeniedError =
  | SandboxCapabilityDeniedError
  | SandboxKeyRestrictedError;

/**
 * The JSON body for a sandbox access denial. A key held to automations adds
 * `code: "AUTOMATION_REQUIRED"`, so an API caller can tell it apart from a
 * team role denial.
 */
export function sandboxAccessDeniedBody(error: SandboxAccessDeniedError): {
  error: string;
  code?: string;
} {
  return "code" in error
    ? { error: error.message, code: error.code }
    : { error: error.message };
}

/** The 403 response for a sandbox access denial. */
export function sandboxAccessDeniedResponse(error: SandboxAccessDeniedError) {
  return NextResponse.json(sandboxAccessDeniedBody(error), {
    status: error.status,
  });
}
