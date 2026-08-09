import type * as Sentry from "@sentry/nextjs";

function exceptionValue(event: Sentry.Event): string {
  return event.exception?.values?.[0]?.value ?? "";
}

function topFrameFilename(event: Sentry.Event): string {
  const frames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];
  return frames.at(-1)?.filename ?? "";
}

export function isDevelopmentHttpAbortEvent(event: Sentry.Event): boolean {
  return (
    event.environment === "development" &&
    exceptionValue(event) === "aborted" &&
    topFrameFilename(event) === "node:_http_server"
  );
}

export function beforeSendServerEvent<TEvent extends Sentry.Event>(
  event: TEvent
): TEvent | null {
  if (isDevelopmentHttpAbortEvent(event)) {
    return null;
  }

  return event;
}
