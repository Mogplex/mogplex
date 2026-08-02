export type SandboxCreateRequestValidationCode =
  | "reserved_port"
  | "env_payload_too_large";

export class SandboxCreateRequestValidationError extends Error {
  readonly code: SandboxCreateRequestValidationCode;

  constructor(code: SandboxCreateRequestValidationCode, message: string) {
    super(message);
    this.name = "SandboxCreateRequestValidationError";
    this.code = code;
  }
}
