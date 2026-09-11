import { NextResponse } from "next/server";
import {
  TERMINAL_EXEC_MODE_HEADER,
  TERMINAL_EXEC_MODE_IMMEDIATE,
} from "@/lib/sandbox/terminal-exec-response";
import { redactSecretsInValue } from "@/lib/ai-telemetry";

/**
 * Escapes a string value for safe inclusion in single-quoted shell arguments.
 */
export function escapeShell(value: string) {
  return value.replace(/'/g, String.raw`'\''`);
}

const SHELL_CONTROL_CHARACTERS = /[;&|<>()`$\n\r]/;

/**
 * Recognizes a bare `cd [dir]` the terminal uses to move its working
 * directory. A command that merely starts with `cd` and continues with shell
 * operators (`cd apps && pnpm test`, `cd "$(git rev-parse --show-toplevel)"`)
 * is a shell command and must run as one, not be treated as a directory name.
 */
export function parseStandaloneChangeDirectory(
  command: string
): { target: string } | null {
  const match = /^cd(?:\s+(.+))?$/.exec(command);
  if (!match) return null;
  const target = (match[1] ?? ".").trim();
  if (SHELL_CONTROL_CHARACTERS.test(target)) return null;
  return { target };
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
  return NextResponse.json(redactSecretsInValue(body), {
    ...init,
    headers: buildImmediateExecHeaders(init?.headers),
  });
}
