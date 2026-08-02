"use client"

import type { VercelLinkedProjectValidation } from "@/lib/vercel/validation"

interface Props {
  validation: VercelLinkedProjectValidation
  className?: string
}

export function VercelLinkedProjectValidationBanner({ validation, className = "" }: Props) {
  return (
    <div className={`${className} border px-3 py-2 text-[11px] ${
      validation.state === "valid"
        ? "border-accent-green/30 bg-accent-green/10 text-accent-green"
        : "border-amber-500/30 bg-amber-500/10 text-amber-200"
    }`}>
      <div>{validation.message}</div>
      {validation.action === "link_personal_vercel" && (
        // eslint-disable-next-line @next/next/no-html-link-for-pages -- OAuth start requires full page nav, cross-origin redirect
        <a href="/api/auth/vercel" className="mt-1 inline-flex text-foreground underline underline-offset-2">
          Link Personal Vercel
        </a>
      )}
      {validation.action === "reconnect_personal_vercel" && (
        // eslint-disable-next-line @next/next/no-html-link-for-pages -- OAuth start requires full page nav, cross-origin redirect
        <a href="/api/auth/vercel" className="mt-1 inline-flex text-foreground underline underline-offset-2">
          Reconnect Personal Vercel
        </a>
      )}
      {validation.action === "select_project" && (
        <div className="mt-1 text-foreground/90">
          Select a project above or create one now.
        </div>
      )}
      {validation.action === "review_workspace_settings" && (
        <div className="mt-1 text-foreground/90">
          Review the workspace-linked project or pin a repo-linked project here instead.
        </div>
      )}
    </div>
  )
}
