"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { scopedHref } from "@/lib/scoped-href"
import { ArrowRight, User, Code, Page, Settings as SettingsIcon } from "iconoir-react"

const AGENT_SECTIONS = [
  {
    key: "definitions",
    title: "Agent Definitions",
    description: "Manage your agent roster, harness configurations, and model assignments.",
    pathSuffix: "/agents/roster",
    icon: User,
  },
  {
    key: "rules",
    title: "Rules",
    description: "Repository conventions and policies that guide agent behavior.",
    pathSuffix: "/agents/rules",
    icon: Page,
  },
  {
    key: "skills",
    title: "Skills",
    description: "Reusable capabilities and tools available to your agents.",
    pathSuffix: "/agents/skills",
    icon: Code,
  },
  {
    key: "context",
    title: "Context",
    description: "Global context and documentation agents use for grounding.",
    pathSuffix: "/agents/context",
    icon: SettingsIcon,
  },
] as const

export function AgentsSettingsSection() {
  const { scope } = useParams<{ scope: string }>()

  return (
    <section className="border border-border/60 bg-card">
      <div className="px-5 pt-5 pb-2">
        <div className="ui-section-title">Agents &amp; Harnesses</div>
        <div className="ui-section-caption">
          Agent definitions, rules, skills, and context that control how agents work in your repositories.
        </div>
      </div>
      <div className="px-5 pb-5 space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          {AGENT_SECTIONS.map((section) => {
            const Icon = section.icon
            const href = scopedHref(scope, section.pathSuffix)
            return (
              <Link
                key={section.key}
                href={href}
                className="group border border-border rounded-lg bg-background/60 p-4 hover:border-primary/40 hover:bg-secondary/50 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="shrink-0 size-9 rounded-md bg-muted flex items-center justify-center">
                    <Icon className="size-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-foreground">{section.title}</span>
                      <ArrowRight className="size-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
                    </div>
                    <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                      {section.description}
                    </p>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
        <div className="border-t border-border pt-3 mt-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-foreground">MCP Servers</div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                External tools and APIs available to your agents.
              </p>
            </div>
            <Link
              href={scopedHref(scope, "/settings?tab=connections")}
              className="inline-flex items-center gap-1 text-[11px] text-accent-blue hover:underline"
            >
              Manage connections
              <ArrowRight className="size-3" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
