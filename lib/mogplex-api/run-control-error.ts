type RunControlErrorCode = "BAD_REQUEST" | "CONFLICT" | "NOT_FOUND";

export class MogplexApiRunControlError extends Error {
  code: RunControlErrorCode;
  status: number;

  constructor(code: RunControlErrorCode, message: string, status: number) {
    super(message);
    this.name = "MogplexApiRunControlError";
    this.code = code;
    this.status = status;
    Object.setPrototypeOf(this, MogplexApiRunControlError.prototype);
  }
}
