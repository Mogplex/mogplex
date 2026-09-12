"use client";

import { Check, MoreHoriz } from "iconoir-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger,
  DropdownMenuRadioGroup, DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";

export type SessionGrouping = "project" | "list";
export type SessionSort = "recent" | "alpha";

export function SessionListOptions({ grouping, sort, onGroupingChange, onSortChange }: {
  grouping: SessionGrouping;
  sort: SessionSort;
  onGroupingChange: (value: SessionGrouping) => void;
  onSortChange: (value: SessionSort) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Sidebar options" title="Sidebar options" className="grid size-7 place-items-center rounded-md hover:bg-ink-800 hover:text-ink-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <MoreHoriz className="size-4" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Organize sidebar</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={grouping} onValueChange={value => onGroupingChange(value as SessionGrouping)}>
              <DropdownMenuRadioItem value="project" indicator={<Check aria-hidden="true" />}>By project</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="list" indicator={<Check aria-hidden="true" />}>In one list</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Sort chats by</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={sort} onValueChange={value => onSortChange(value as SessionSort)}>
              <DropdownMenuRadioItem value="recent" indicator={<Check aria-hidden="true" />}>Recent activity</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="alpha" indicator={<Check aria-hidden="true" />}>Name</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
