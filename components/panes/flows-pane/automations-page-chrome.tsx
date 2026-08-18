"use client"

import Link from "next/link"
import { Flash, Plus, RefreshDouble } from "iconoir-react"
import { Button } from "@/components/ui/button"

export type AutomationCreateState = "loading" | "ready" | "needs-connection"

function AutomationPrimaryAction({
  createState,
  connectionsHref,
  onCreate,
  testId,
}: {
  createState: AutomationCreateState
  connectionsHref: string
  onCreate: () => void
  testId: string
}) {
  if (createState === "needs-connection") {
    return (
      <Button asChild data-testid={testId}>
        <Link href={connectionsHref}>Connect GitHub</Link>
      </Button>
    )
  }

  return (
    <Button
      type="button"
      data-testid={testId}
      disabled={createState === "loading"}
      onClick={onCreate}
    >
      {createState === "loading" ? (
        <RefreshDouble className="mr-2 size-3.5 animate-spin" />
      ) : (
        <Plus className="mr-2 size-3.5" />
      )}
      {createState === "loading" ? "Loading GitHub" : "New automation"}
    </Button>
  )
}

export function AutomationsPageHeader({
  totalCount,
  activeCount,
  createState,
  connectionsHref,
  onCreate,
}: {
  totalCount: number
  activeCount: number
  createState: AutomationCreateState
  connectionsHref: string
  onCreate: () => void
}) {
  return (
    <header
      data-testid="automations-page-header"
      className="flex min-h-[76px] shrink-0 items-center gap-5 border-b border-border bg-card px-5 py-3"
    >
      <div className="grid size-10 shrink-0 place-items-center rounded-lg border border-accent-blue/25 bg-accent-blue/[0.08] text-accent-blue shadow-[inset_0_0_18px_rgb(46_92_255_/_0.08)]">
        <Flash className="size-5" />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-accent-green shadow-[0_0_8px_rgb(34_197_94_/_0.6)]" />
          <span className="text-[9px] font-semibold tracking-[0.2em] text-muted-foreground uppercase">
            Automation control
          </span>
        </div>
        <h1 className="mt-0.5 text-lg font-semibold tracking-[-0.02em] text-foreground">
          Automations
        </h1>
        <p className="hidden text-[11px] text-muted-foreground @4xl/flows:block">
          Save time on repeat repository work. Build, publish, and review each workflow here.
        </p>
      </div>
      <div className="ml-auto hidden h-10 items-stretch overflow-hidden rounded-md border border-border bg-background @2xl/flows:flex">
        <div className="flex min-w-[70px] flex-col justify-center px-3">
          <span className="text-[8px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">Total</span>
          <span className="font-mono text-sm font-semibold text-foreground">{totalCount}</span>
        </div>
        <div className="flex min-w-[70px] flex-col justify-center border-l border-border px-3">
          <span className="text-[8px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">Live</span>
          <span className="font-mono text-sm font-semibold text-accent-green">{activeCount}</span>
        </div>
      </div>
      <AutomationPrimaryAction
        createState={createState}
        connectionsHref={connectionsHref}
        onCreate={onCreate}
        testId="automations-new"
      />
    </header>
  )
}

export function AutomationsEmptyState({
  createState,
  connectionsHref,
  onCreate,
  templatePicker,
}: {
  createState: AutomationCreateState
  connectionsHref: string
  onCreate: () => void
  templatePicker: React.ReactNode
}) {
  return (
    <section
      data-testid="automations-empty-state"
      className="relative flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 py-10"
      style={{
        backgroundImage: "radial-gradient(circle at center, var(--border) 0.75px, transparent 0.75px)",
        backgroundSize: "22px 22px",
      }}
    >
      <div className="w-full max-w-3xl overflow-hidden rounded-xl border border-border bg-card shadow-2xl shadow-black/20">
        <div className="flex h-9 items-center border-b border-border bg-background px-4">
          <span className="font-mono text-[9px] tracking-[0.18em] text-muted-foreground uppercase">
            First automation
          </span>
          <span className="ml-auto flex items-center gap-2 text-[9px] font-medium text-accent-green">
            <span className="size-1.5 rounded-full bg-accent-green" />
            Ready for setup
          </span>
        </div>
        <div className="grid gap-8 px-7 py-9 md:grid-cols-[minmax(0,1fr)_230px] md:px-10 md:py-11">
          <div>
            <div className="grid size-12 place-items-center rounded-lg border border-accent-blue/25 bg-accent-blue/[0.08] text-accent-blue">
              <Flash className="size-6" />
            </div>
            <h2 className="mt-6 max-w-lg text-2xl font-semibold tracking-[-0.035em] text-foreground">
              Make repeat repository work automatic
            </h2>
            <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">
              Choose a starter and connect it to a repository. Nothing runs before you publish.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              {createState === "ready" ? templatePicker : (
                <AutomationPrimaryAction
                  createState={createState}
                  connectionsHref={connectionsHref}
                  onCreate={onCreate}
                  testId="automations-empty-new"
                />
              )}
              <span className="text-[10px] text-muted-foreground">
                Your draft stays private until you publish.
              </span>
            </div>
          </div>
          <ol className="grid content-center gap-2" aria-label="Automation setup steps">
            {[
              ["01", "Choose a trigger", "Pick a repository event or schedule."],
              ["02", "Add the work", "Add agents, conditions, and actions."],
              ["03", "Publish", "Test the trigger, then set it live."],
            ].map(([number, title, description]) => (
              <li key={number} className="grid grid-cols-[30px_1fr] gap-3 rounded-lg border border-border bg-background/70 p-3">
                <span className="font-mono text-[10px] font-semibold text-accent-blue">{number}</span>
                <span>
                  <span className="block text-xs font-semibold text-foreground">{title}</span>
                  <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">{description}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  )
}
