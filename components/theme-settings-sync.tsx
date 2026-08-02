"use client"

import { useEffect, useRef } from "react"
import { usePathname } from "next/navigation"
import { useTheme } from "next-themes"
import {
  applyThemePreference,
  getThemePreferenceMutationVersion,
  isThemePreference,
} from "@/lib/theme-preferences"
import { isPublicRoutePath } from "@/lib/auth-route-policy"

export function ThemeSettingsSync() {
  const pathname = usePathname()
  const { setTheme } = useTheme()
  const setThemeRef = useRef(setTheme)

  useEffect(() => {
    setThemeRef.current = setTheme
  }, [setTheme])

  useEffect(() => {
    if (isPublicRoutePath(pathname)) return

    let cancelled = false
    const initialThemeMutationVersion = getThemePreferenceMutationVersion()

    fetch("/api/settings")
      .then(async (response) => {
        if (!response.ok) return null
        const contentType = response.headers.get("content-type") ?? ""
        if (!contentType.includes("application/json")) return null
        return response.json()
      })
      .then((data) => {
        // Unmount cancellation and local theme mutations are separate races.
        if (cancelled) return

        const nextTheme = data?.theme
        if (!isThemePreference(nextTheme)) return
        // If the user changed themes while this read was in flight, its result is stale.
        if (getThemePreferenceMutationVersion() !== initialThemeMutationVersion) return
        applyThemePreference(nextTheme)
        setThemeRef.current(nextTheme)
      })
      .catch((error: unknown) => {
        if (process.env.NODE_ENV !== "production") {
          console.error("[ThemeSettingsSync]", error)
        }
      })

    return () => {
      cancelled = true
    }
  }, [pathname])

  return null
}
