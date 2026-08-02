"use client"
import Link from "next/link"
import { useParams, usePathname } from "next/navigation"
import { scopedHref } from "@/lib/scoped-href"
import { SandboxLaunchProvider } from "@/components/sandbox-launch-provider"

type TabId = "workspace" | "repositories"

const TABS: { id: TabId; label: string; subpath: string }[] = [
  { id: "workspace", label: "Workspace", subpath: "/projects/workspace" },
  { id: "repositories", label: "Repositories", subpath: "/projects/repositories" },
]

function resolveActiveTab(pathname: string, scope: string): TabId {
  if (pathname.startsWith(scopedHref(scope, "/projects/repositories"))) {
    return "repositories"
  }
  return "workspace"
}

export default function ProjectsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || ""
  const { scope } = useParams<{ scope: string }>()
  const activeTab = resolveActiveTab(pathname, scope)

  return (
    <SandboxLaunchProvider>
      <div className="flex h-full min-h-0 flex-col">
        <nav
          aria-label="Projects sections"
          className="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-background px-3"
        >
          {TABS.map((tab) => {
            const isActive = tab.id === activeTab
            return (
              <Link
                key={tab.id}
                href={scopedHref(scope, tab.subpath)}
                aria-current={isActive ? "page" : undefined}
                className={`relative flex h-9 items-center px-3 text-[13px] transition-colors ${
                  isActive
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
                <span
                  aria-hidden="true"
                  className={`absolute inset-x-3 -bottom-px h-px transition-colors ${
                    isActive ? "bg-foreground" : "bg-transparent"
                  }`}
                />
              </Link>
            )
          })}
        </nav>
        <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
      </div>
    </SandboxLaunchProvider>
  )
}
