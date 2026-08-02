type ErrorLike = {
  message: string;
} | null;

export class ConnectionTestPersistenceError extends Error {
  code = "TEST_STATUS_PERSIST_FAILED" as const;

  constructor(
    message: string,
    public causeMessage?: string
  ) {
    super(message);
    this.name = "ConnectionTestPersistenceError";
  }
}

export function ensureConnectionTestWriteSucceeded(
  error: ErrorLike,
  message: string
) {
  if (!error) return;
  throw new ConnectionTestPersistenceError(message, error.message);
}
