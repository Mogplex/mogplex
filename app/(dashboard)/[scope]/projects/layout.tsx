"use client"
import { SandboxLaunchProvider } from "@/components/sandbox-launch-provider"

export default function ProjectsLayout({ children }: { children: React.ReactNode }) {
  return (
    <SandboxLaunchProvider>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
      </div>
    </SandboxLaunchProvider>
  )
}
