"use client"
import Link from "next/link"
import { useParams } from "next/navigation"
import { TopBar } from "@/components/top-bar"
import { StatusBar } from "@/components/status-bar"
import { AppSidebar } from "@/components/app-sidebar"
import { MogplexMark } from "@/components/brand/mogplex-mark"
import { CommandPaletteProvider } from "@/components/command-palette-provider"
import { NewModelsDialog } from "@/components/new-models-dialog"
import { scopedHref } from "@/lib/scoped-href"

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { scope } = useParams<{ scope: string }>()
  return (
    <CommandPaletteProvider>
      <div
        className="app-shell h-dvh bg-background p-1.5 pt-[calc(env(safe-area-inset-top)+6px)] text-foreground sm:p-3 sm:pt-[calc(env(safe-area-inset-top)+12px)]"
        data-testid="dashboard-shell"
      >
        <div className="app-window-frame flex h-full min-h-0 flex-col">
          <div className="app-window-chrome shrink-0 px-3">
            <div className="flex items-center">
              <Link
                href={scopedHref(scope, "/control")}
                aria-label="Mogplex home"
                className="flex items-center gap-3 rounded-xl text-foreground outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
              >
                <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
                  <MogplexMark className="size-5" />
                </span>
                <span className="text-[20px] font-semibold tracking-normal">
                  mogplex
                </span>
              </Link>
            </div>
            <div aria-hidden="true" />
            <TopBar />
          </div>
          <div className="flex min-h-0 flex-1">
            <AppSidebar />
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="app-shell-content min-h-0 flex-1 overflow-auto">
                {children}
              </div>
              <StatusBar />
            </div>
          </div>
        </div>
      </div>
      <NewModelsDialog />
    </CommandPaletteProvider>
  )
}
