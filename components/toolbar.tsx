"use client"
import { MogplexWordmark } from "@/components/brand/mogplex-wordmark"
import type { PaneType } from "@/hooks/use-split-panes"
import { useUser } from "@/hooks/use-user"

const TYPES: { type: PaneType; label: string }[] = [
  { type: "agent", label: "Agent" },
  { type: "terminal", label: "Term" },
  { type: "editor", label: "Edit" },
  { type: "tools", label: "Tools" },
  { type: "stats", label: "Stats" },
  { type: "memories", label: "Mem" },
  { type: "rules", label: "Rules" },
  { type: "skills", label: "Skills" },
]

interface Props {
  activeId: string
  activeRepo?: { full_name: string } | null
  onSplit: (dir: "horizontal" | "vertical", type: PaneType) => void
}

export function Toolbar({ activeId: _activeId, activeRepo, onSplit }: Props) {
  const { user, logout } = useUser()

  return (
    <div className="flex items-center gap-4 px-3 h-8 bg-background border-b border-border text-xs">
      <MogplexWordmark height={12} className="text-primary" />
      <div className="h-3 w-px bg-border" />
      {activeRepo && (
        <>
          <span className="text-foreground">{activeRepo.full_name}</span>
          <div className="h-3 w-px bg-border" />
        </>
      )}
      {TYPES.map(t => (
        <div key={t.type} className="flex items-center">
          <span className="text-muted-foreground mr-1">{t.label}</span>
          <button onClick={() => onSplit("horizontal", t.type)} className="px-1.5 py-0.5 bg-secondary hover:bg-primary hover:text-primary-foreground text-foreground border border-border" title={`Split horizontal: ${t.label}`}>H</button>
          <button onClick={() => onSplit("vertical", t.type)} className="px-1.5 py-0.5 bg-secondary hover:bg-primary hover:text-primary-foreground text-foreground border border-border border-l-0" title={`Split vertical: ${t.label}`}>V</button>
        </div>
      ))}
      <div className="ml-auto flex items-center gap-3">
        {user ? (
          <>
            {user.avatar_url && <img src={user.avatar_url} alt="" className="w-5 h-5 rounded-full" />}
            <span className="text-foreground">{user.username || user.name}</span>
            <button onClick={logout} className="text-muted-foreground hover:text-destructive">LOGOUT</button>
          </>
        ) : (
          // eslint-disable-next-line @next/next/no-html-link-for-pages -- hard nav so any stale session cookies clear
          <a href="/login" className="text-primary hover:underline">LOGIN</a>
        )}
      </div>
    </div>
  )
}
