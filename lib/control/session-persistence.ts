import type { UIMessage } from "ai";
import type { ControlSessionRecord } from "./session-types";

export type { ControlSessionRecord } from "./session-types";

type SessionFetch = (
  input: string,
  init?: RequestInit
) => Promise<Pick<Response, "json" | "ok" | "status">>;

export class ControlSessionMutationError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export type ControlSessionMutationFields = {
  title?: string;
  model_id?: string | null;
  pinned?: boolean;
  archived?: boolean;
  messages?: UIMessage[];
};

export async function mutateControlSession({
  sessionId,
  fields,
  expectedUpdatedAt,
  summary = false,
  rebaseOnConflict = true,
  fetcher = fetch,
}: {
  sessionId: string;
  fields: ControlSessionMutationFields;
  expectedUpdatedAt: string;
  summary?: boolean;
  rebaseOnConflict?: boolean;
  fetcher?: SessionFetch;
}): Promise<ControlSessionRecord> {
  const endpoint = summary
    ? "/api/control/sessions?summary=true"
    : "/api/control/sessions";
  const put = (revision: string) =>
    fetcher(endpoint, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: sessionId,
        ...fields,
        expected_updated_at: revision,
      }),
    });

  let res = await put(expectedUpdatedAt);
  if (res.status === 409 && rebaseOnConflict) {
    const fresh = await fetcher(`/api/control/sessions?id=${sessionId}`);
    if (!fresh.ok) {
      throw new ControlSessionMutationError(
        `Failed to rebase control session (${fresh.status})`,
        fresh.status
      );
    }
    const record = (await fresh.json()) as ControlSessionRecord;
    res = await put(record.updated_at);
  }
  if (!res.ok) {
    throw new ControlSessionMutationError(
      `Failed to persist control session (${res.status})`,
      res.status
    );
  }

  const { session } = (await res.json()) as {
    session: ControlSessionRecord;
  };
  return session;
}

export async function persistControlSessionMessages(input: {
  sessionId: string;
  messages: UIMessage[];
  expectedUpdatedAt: string;
  fetcher?: SessionFetch;
}): Promise<ControlSessionRecord> {
  return mutateControlSession({
    sessionId: input.sessionId,
    fields: { messages: input.messages },
    expectedUpdatedAt: input.expectedUpdatedAt,
    fetcher: input.fetcher,
  });
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
