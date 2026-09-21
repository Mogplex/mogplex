"use client";
import { useCallback, useMemo, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { useSkillCatalog } from "@/hooks/use-skill-catalog";
import {
  applySkillSuggestion,
  getSkillSuggestions,
} from "@/lib/skill-catalog/suggest";

type SkillSuggestionMenu = {
  /** True when the key was used by the menu and the composer should stop. */
  handleKeyDown: (event: KeyboardEvent) => boolean;
  element: ReactNode;
};

/**
 * Completion for `/slug` and `$slug` in a plain textarea. The composer keeps
 * owning the text; this only proposes a handle and writes it back. Sending
 * the message is what loads the skill, on the server.
 */
export function useSkillSuggestionMenu(input: {
  value: string;
  onChange: (value: string) => void;
  repoId?: string | null;
}): SkillSuggestionMenu {
  const { value, onChange } = input;
  const { skills } = useSkillCatalog(input.repoId);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);

  const suggestions = useMemo(() => {
    const found = getSkillSuggestions(value, skills);
    return found && found.token !== dismissedFor ? found : null;
  }, [dismissedFor, skills, value]);
  const matches = suggestions?.matches;
  const index = matches ? Math.min(activeIndex, matches.length - 1) : 0;

  const accept = useCallback(
    (slug: string) => {
      onChange(applySkillSuggestion(value, slug));
      setActiveIndex(0);
    },
    [onChange, value]
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!matches || !suggestions) return false;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActiveIndex((index + step + matches.length) % matches.length);
        return true;
      }
      if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
        event.preventDefault();
        accept(matches[index].slug);
        return true;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissedFor(suggestions.token);
        return true;
      }
      return false;
    },
    [accept, index, matches, suggestions]
  );

  const element = matches ? (
    <ul
      role="listbox"
      aria-label="Skills"
      data-testid="control-skill-suggestions"
      className="mx-3 mt-3 max-h-56 overflow-y-auto rounded-lg border border-ink-800 bg-ink-950 py-1"
    >
      {matches.map((skill, position) => (
        <li key={skill.slug} role="option" aria-selected={position === index}>
          <button
            type="button"
            // Keep focus in the textarea so typing continues after a pick.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => accept(skill.slug)}
            className={`flex w-full items-baseline gap-3 px-3 py-1.5 text-left text-[13px] ${
              position === index ? "bg-ink-800 text-ink-100" : "text-ink-300"
            }`}
          >
            <span className="shrink-0 font-mono text-accent-blue">
              ${skill.slug}
            </span>
            <span className="truncate text-ink-400">
              {skill.description?.trim() || skill.name}
            </span>
          </button>
        </li>
      ))}
    </ul>
  ) : null;

  return { handleKeyDown, element };
}
