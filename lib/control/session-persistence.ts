import type { UIMessage } from "ai";
import type { ControlSessionRecord } from "./session-types";

export type { ControlSessionRecord } from "./session-types";

type SessionFetch = (
  input: string,
  init?: RequestInit
) => Promise<Pick<Response, "json" | "ok" | "status">>;

export async function persistControlSessionMessages({
  sessionId,
  messages,
  expectedUpdatedAt,
  fetcher = fetch,
}: {
  sessionId: string;
  messages: UIMessage[];
  expectedUpdatedAt: string;
  fetcher?: SessionFetch;
}): Promise<ControlSessionRecord> {
  const put = (revision: string) =>
    fetcher("/api/control/sessions", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: sessionId,
        messages,
        expected_updated_at: revision,
      }),
    });

  let res = await put(expectedUpdatedAt);
  if (res.status === 409) {
    // Retry against the fresh revision. The server merges by message identity,
    // retaining saved replies that this older browser snapshot cannot contain.
    const fresh = await fetcher(`/api/control/sessions?id=${sessionId}`);
    if (!fresh.ok) {
      throw new Error(`Failed to rebase control session (${fresh.status})`);
    }
    const record = (await fresh.json()) as ControlSessionRecord;
    res = await put(record.updated_at);
  }
  if (!res.ok) {
    throw new Error(`Failed to persist control session (${res.status})`);
  }

  const { session } = (await res.json()) as {
    session: ControlSessionRecord;
  };
  return session;
}

export async function persistBackedControlSessionMessages({
  expectedUpdatedAt,
  ...input
}: {
  sessionId: string;
  messages: UIMessage[];
  expectedUpdatedAt: string | undefined;
  fetcher?: SessionFetch;
}): Promise<ControlSessionRecord | null> {
  // Seeded mission chats do not have a database row. Their messages are
  // intentionally local-only until a control session is created.
  if (input.messages.length === 0 || !expectedUpdatedAt) return null;
  return persistControlSessionMessages({
    ...input,
    expectedUpdatedAt,
  });
}
