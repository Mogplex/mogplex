"use client";

import useSWR from "swr";

type NamedItem = { id: string; name: string; description?: string | null };

const listFetcher = async (url: string): Promise<NamedItem[]> => {
  const res = await fetch(url);
  return res.ok ? ((await res.json()) as NamedItem[]) : [];
};

function toggle(ids: string[], id: string, on: boolean) {
  if (on) return ids.includes(id) ? ids : [...ids, id];
  return ids.filter((entry) => entry !== id);
}

function CheckList({
  label,
  hint,
  items,
  selected,
  onChange,
  emptyText,
}: {
  label: string;
  hint: string;
  items: NamedItem[];
  selected: string[];
  onChange: (next: string[]) => void;
  emptyText: string;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-foreground text-sm font-medium">{label}</legend>
      <p className="text-muted-foreground text-xs">{hint}</p>
      {items.length === 0 ? (
        <p className="text-muted-foreground text-xs">{emptyText}</p>
      ) : (
        <div className="border-border max-h-40 space-y-1 overflow-y-auto rounded-sm border p-2">
          {items.map((item) => (
            <label key={item.id} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.includes(item.id)}
                onChange={(e) =>
                  onChange(toggle(selected, item.id, e.target.checked))
                }
                className="mt-1"
              />
              <span className="min-w-0">
                <span className="text-foreground block truncate">
                  {item.name}
                </span>
                {item.description && (
                  <span className="text-muted-foreground block truncate text-xs">
                    {item.description}
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

/**
 * Skills, rules, and team sharing for an agent. Skills and rules come from
 * the editor's own library; the resolver loads them by id at run time.
 */
export function AgentAttachmentsFields({
  skillIds,
  setSkillIds,
  ruleIds,
  setRuleIds,
  shared,
  setShared,
  canShare,
  canEditSharing,
}: {
  skillIds: string[];
  setSkillIds: (ids: string[]) => void;
  ruleIds: string[];
  setRuleIds: (ids: string[]) => void;
  shared: boolean;
  setShared: (shared: boolean) => void;
  canShare: boolean;
  canEditSharing: boolean;
}) {
  const { data: skills = [] } = useSWR<NamedItem[]>("/api/skills", listFetcher);
  const { data: rules = [] } = useSWR<NamedItem[]>(
    "/api/rules?table=agent_rules",
    listFetcher
  );

  return (
    <div className="space-y-5">
      <div className="grid gap-x-6 gap-y-5 md:grid-cols-2">
        <CheckList
          label="Skills"
          hint="Written into the sandbox as skill files the agent reads on demand."
          items={skills}
          selected={skillIds}
          onChange={setSkillIds}
          emptyText="No skills in your library yet."
        />
        <CheckList
          label="Rules"
          hint="Inlined into every run as instructions that always apply."
          items={rules}
          selected={ruleIds}
          onChange={setRuleIds}
          emptyText="No rules in your library yet."
        />
      </div>
      {canShare && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={shared}
            disabled={!canEditSharing}
            onChange={(e) => setShared(e.target.checked)}
            className="mt-1"
          />
          <span>
            <span className="text-foreground block">Share with team</span>
            <span className="text-muted-foreground block text-xs">
              {canEditSharing
                ? "Teammates can run and edit this agent. Only you can change sharing or delete it."
                : "Only the owner can change where this agent is shared."}
            </span>
          </span>
        </label>
      )}
    </div>
  );
}
