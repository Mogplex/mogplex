import { NextResponse } from "next/server";
import {
  TERMINAL_EXEC_MODE_HEADER,
  TERMINAL_EXEC_MODE_IMMEDIATE,
} from "@/lib/sandbox/terminal-exec-response";

/**
 * Escapes a string value for safe inclusion in single-quoted shell arguments.
 */
export function escapeShell(value: string) {
  return value.replace(/'/g, String.raw`'\''`);
}

/**
 * Builds response headers with the immediate exec mode marker.
 */
export function buildImmediateExecHeaders(headers?: HeadersInit) {
  const nextHeaders = new Headers(headers);
  nextHeaders.set(TERMINAL_EXEC_MODE_HEADER, TERMINAL_EXEC_MODE_IMMEDIATE);
  return nextHeaders;
}

/**
 * Returns a JSON response with immediate exec mode headers.
 */
export function immediateExecJson(
  body: Record<string, unknown>,
  init?: ResponseInit
) {
  return NextResponse.json(body, {
    ...init,
    headers: buildImmediateExecHeaders(init?.headers),
  });
}
