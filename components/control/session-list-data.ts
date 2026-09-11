import type { ControlSessionSummary } from "@/lib/control/session-types";

/** Read every page so a group action also includes chats beyond the first page. */
export async function loadControlSessionList(
  archived = false
): Promise<ControlSessionSummary[]> {
  const sessions: ControlSessionSummary[] = [];
  let after: string | undefined;
  // Activity and pin changes cannot move unread rows behind this cursor.
  // Deleting or archiving an already-read row cannot shift later pages either.
  for (;;) {
    const query = new URLSearchParams({ order: "id" });
    if (archived) query.set("archived", "true");
    if (after) query.set("after", after);
    const response = await fetch(`/api/control/sessions?${query}`);
    if (!response.ok) throw new Error("Could not load chats. Try again.");
    const page = (await response.json()) as ControlSessionSummary[];
    sessions.push(...page);
    if (page.length < 200)
      return sessions.sort(
        (a, b) =>
          Number(b.pinned) - Number(a.pinned) ||
          Date.parse(b.updated_at) - Date.parse(a.updated_at) ||
          a.id.localeCompare(b.id)
      );
    after = page[page.length - 1].id;
  }
}
