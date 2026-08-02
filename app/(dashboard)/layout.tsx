"use client"
import { TopBar } from "@/components/top-bar"
import { StatusBar } from "@/components/status-bar"
import { CommandPaletteProvider } from "@/components/command-palette-provider"
import { NewModelsDialog } from "@/components/new-models-dialog"

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <CommandPaletteProvider>
      <div className="flex h-dvh flex-col bg-background pt-[env(safe-area-inset-top)]">
        <TopBar />
        <div className="flex-1 min-h-0 overflow-auto">{children}</div>
        <StatusBar />
      </div>
      <NewModelsDialog />
    </CommandPaletteProvider>
  )
}
