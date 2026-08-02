"use client"
import Link from "next/link"
import { useParams, usePathname } from "next/navigation"
import { scopedHref } from "@/lib/scoped-href"

const SUB_NAV = [
  { subpath: "/agents/roster", label: "Roster" },
  { subpath: "/agents/skills", label: "Skills" },
  { subpath: "/agents/rules", label: "Rules" },
  { subpath: "/agents/context", label: "Context" },
] as const

export default function AgentsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { scope } = useParams<{ scope: string }>()

  return (
    <div className="min-h-full">
      <div className="px-3 pt-4 pb-0 space-y-4 md:px-6 md:pt-6">
        <div>
          <h1 className="ui-page-title">Agents</h1>
          <p className="ui-page-subtitle">
            Manage your agent roster, skills, rules, and shared context.
          </p>
        </div>
        <nav className="flex border-b border-border">
          {SUB_NAV.map((item) => {
            const href = scopedHref(scope, item.subpath)
            const isActive =
              pathname === href || pathname.startsWith(`${href}/`)
            return (
              <Link
                key={item.subpath}
                href={href}
                className={`px-4 py-2.5 text-sm transition-colors ${
                  isActive
                    ? "text-foreground border-b-2 border-foreground -mb-px"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>
      </div>
      {children}
    </div>
  )
}
