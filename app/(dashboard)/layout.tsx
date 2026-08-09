"use client"
import { TopBar } from "@/components/top-bar"
import { StatusBar } from "@/components/status-bar"
import { AppSidebar } from "@/components/app-sidebar"
import { CommandPaletteProvider } from "@/components/command-palette-provider"
import { NewModelsDialog } from "@/components/new-models-dialog"

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <CommandPaletteProvider>
      <div
        className="app-shell h-dvh bg-background p-1.5 pt-[calc(env(safe-area-inset-top)+6px)] text-foreground sm:p-3 sm:pt-[calc(env(safe-area-inset-top)+12px)]"
        data-testid="dashboard-shell"
      >
        <div className="app-window-frame flex h-full min-h-0 flex-col">
          <div className="app-window-chrome shrink-0 px-3">
            <div />
            <div />
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
