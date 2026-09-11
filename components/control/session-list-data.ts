import type { ControlSessionSummary } from "@/lib/control/session-types";

/** Read every page so a group action also includes chats beyond the first page. */
export async function loadControlSessionList(
  archived = false
): Promise<ControlSessionSummary[]> {
  const sessions = new Map<string, ControlSessionSummary>();
  for (let offset = 0; ; offset += 200) {
    const query = new URLSearchParams();
    if (archived) query.set("archived", "true");
    if (offset) query.set("offset", String(offset));
    const response = await fetch(
      `/api/control/sessions${query.size > 0 ? `?${query}` : ""}`
    );
    if (!response.ok) throw new Error("Could not load chats. Try again.");
    const page = (await response.json()) as ControlSessionSummary[];
    for (const session of page) sessions.set(session.id, session);
    if (page.length < 200) return [...sessions.values()];
  }
}
