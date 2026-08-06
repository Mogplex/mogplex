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
        className="app-shell flex h-dvh bg-background pt-[env(safe-area-inset-top)]"
        data-testid="dashboard-shell"
      >
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <div className="app-shell-content flex-1 min-h-0 overflow-auto">{children}</div>
          <StatusBar />
        </div>
      </div>
      <NewModelsDialog />
    </CommandPaletteProvider>
  )
}
