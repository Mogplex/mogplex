"use client";

import { useEffect, useState } from "react";
import { SidebarExpand } from "iconoir-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { SessionList, type SessionListProps } from "./session-list";

/** The same list and action handlers as desktop, with phone-sized navigation. */
export function MobileSessionList(props: SessionListProps) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 768px)");
    const closeOnDesktop = () => { if (desktop.matches) setOpen(false); };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button type="button" aria-label="Open sessions" className="grid size-10 shrink-0 place-items-center rounded-md text-ink-400 hover:bg-ink-800 hover:text-ink-100 md:hidden">
          <SidebarExpand className="size-5" aria-hidden="true" />
        </button>
      </SheetTrigger>
      <SheetContent side="left" className="gap-0 border-ink-800 bg-ink-900 text-ink-100 md:hidden">
        <SheetHeader className="shrink-0">
          <SheetTitle className="text-ink-100">Sessions</SheetTitle>
          <SheetDescription className="sr-only">Select a chat or start a new session.</SheetDescription>
        </SheetHeader>
        <SessionList {...props} presentation="drawer"
          onSelect={id => { props.onSelect(id); setOpen(false); }}
          onNew={target => { props.onNew(target); setOpen(false); }}
          onSearch={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
