export class MogplexApiClientError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "MogplexApiClientError";
    this.code = code;
    this.status = status;
    Object.setPrototypeOf(this, MogplexApiClientError.prototype);
  }
}
