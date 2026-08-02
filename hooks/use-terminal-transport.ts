"use client";

import { useEffect, useState } from "react";
import { getActiveTeamRequestHeaders } from "@/components/active-scope-provider";
import type {
  TerminalPtyConnectInfo,
  TerminalPtyUnavailableReason,
} from "@/lib/sandbox/terminal-pty-config";

export type TerminalExecFallbackReason =
  | TerminalPtyUnavailableReason
  | "connect_failed"
  | "http_error";

export type TerminalTransportInfo =
  | {
      kind: "exec";
      reason?: TerminalExecFallbackReason;
      detail?: string;
    }
  | {
      kind: "pty";
      terminalSessionKey: string;
      wsUrl: string;
      token: string;
      expiresAt: number;
    };

function stripAnsiAndControlCharacters(value: string) {
  let normalized = "";

  for (let index = 0; index < value.length; index += 1) {
    const charCode = value.charCodeAt(index);

    if (charCode === 27) {
      if (value[index + 1] === "[") {
        index += 1;
        while (index + 1 < value.length) {
          index += 1;
          const finalCode = value.charCodeAt(index);
          if (finalCode >= 64 && finalCode <= 126) {
            break;
          }
        }
      }
      continue;
    }

    if ((charCode >= 0 && charCode <= 31) || charCode === 127) {
      normalized += " ";
      continue;
    }

    normalized += value[index];
  }

  return normalized;
}

function sanitizeFallbackDetail(value: unknown) {
  if (typeof value !== "string") return undefined;

  const normalized = stripAnsiAndControlCharacters(value)
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.length === 0) return undefined;

  return normalized.slice(0, 200);
}

const EXEC_FALLBACK: TerminalTransportInfo = { kind: "exec" };

function buildTransportKey(
  sandboxId: string | undefined,
  terminalSessionKey: string | undefined
): string | null {
  return sandboxId && terminalSessionKey
    ? `${sandboxId}::${terminalSessionKey}`
    : null;
}

// Fetches the connect info for the given sandbox once per id change. Returns
// kind:"exec" until the server reports PTY availability — the caller is
// expected to stay on the Phase 2a streaming-exec path until then.
export function useTerminalTransport(
  sandboxId: string | undefined,
  terminalSessionKey: string | undefined
): TerminalTransportInfo {
  // Stored alongside the key it was resolved for, so a result can never outlive
  // the sandbox/session pair that produced it.
  const [resolved, setResolved] = useState<{
    key: string;
    info: TerminalTransportInfo;
  } | null>(null);

  useEffect(() => {
    if (!sandboxId || !terminalSessionKey) return;
    const key = `${sandboxId}::${terminalSessionKey}`;
    const setInfo = (info: TerminalTransportInfo) => setResolved({ key, info });
    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/sandbox/${sandboxId}/terminal/connect`, {
          method: "POST",
          headers: getActiveTeamRequestHeaders({
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({ terminalSessionKey }),
          signal: controller.signal,
        });
        if (cancelled) return;
        if (!res.ok) {
          let detail = sanitizeFallbackDetail(
            `terminal connect failed (${res.status})`
          );
          try {
            const payload = (await res.json()) as { error?: unknown };
            detail = sanitizeFallbackDetail(payload?.error) ?? detail;
          } catch {
            // Ignore invalid JSON on error paths and keep the status detail.
          }
          setInfo({ kind: "exec", reason: "http_error", detail });
          return;
        }
        const payload = (await res.json()) as TerminalPtyConnectInfo;
        if (cancelled) return;
        if (payload.available) {
          setInfo({
            kind: "pty",
            terminalSessionKey: payload.terminalSessionKey,
            wsUrl: payload.wsUrl,
            token: payload.token,
            expiresAt: payload.expiresAt,
          });
        } else {
          setInfo({
            kind: "exec",
            reason: payload.reason,
            detail: sanitizeFallbackDetail(payload.detail),
          });
        }
      } catch (err) {
        if ((err as DOMException)?.name === "AbortError") return;
        if (!cancelled) {
          const detail = sanitizeFallbackDetail(
            err instanceof Error ? err.message : undefined
          );
          setInfo({ kind: "exec", reason: "connect_failed", detail });
        }
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [sandboxId, terminalSessionKey]);

  // Derived rather than stored: while a new sandbox/session pair is still
  // resolving, callers fall back to exec instead of seeing the previous
  // sandbox's PTY credentials.
  const transportKey = buildTransportKey(sandboxId, terminalSessionKey);
  return transportKey && resolved?.key === transportKey
    ? resolved.info
    : EXEC_FALLBACK;
}
