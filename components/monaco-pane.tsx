"use client"
import { useRef, useEffect, useState, useCallback } from "react"
import type { editor } from "monaco-editor"
import { useTheme } from "next-themes"
import { getActiveTeamRequestHeaders } from "@/components/active-scope-provider"

interface Props {
  value?: string
  language?: string
  onChange?: (value: string) => void
  readOnly?: boolean
  sandboxId?: string
  filePath?: string
}

const LANG_MAP: Record<string, string> = {
  ts: "typescript", tsx: "typescriptreact", js: "javascript", jsx: "javascriptreact",
  json: "json", md: "markdown", css: "css", html: "html", py: "python",
  yml: "yaml", yaml: "yaml", sh: "shell", sql: "sql", env: "plaintext",
}

function detectLanguage(filePath?: string, fallback = "typescript") {
  if (!filePath) return fallback
  const ext = filePath.split(".").pop()?.toLowerCase() || ""
  return LANG_MAP[ext] || fallback
}

type MonacoThemeMode = "light" | "dark"

function getMonacoThemeName(mode: MonacoThemeMode) {
  return `mogplex-${mode}`
}

function toMonacoHex(color: string) {
  return color.replace(/^#/, "")
}

function withAlpha(color: string, alphaHex: string) {
  const hex = color.replace(/^#/, "")
  if (hex.length === 6) return `#${hex}${alphaHex}`
  if (hex.length === 8) return `#${hex.slice(0, 6)}${alphaHex}`
  return color
}

function createMonacoColorConverter() {
  const canvas = document.createElement("canvas")
  canvas.width = 1
  canvas.height = 1
  const context = canvas.getContext("2d", { willReadFrequently: true })
  if (!context) throw new Error("Could not initialize Monaco theme colors")

  return (color: string) => {
    if (!CSS.supports("color", color)) {
      throw new Error(`Invalid Monaco theme color: ${color}`)
    }

    context.fillStyle = "#010203"
    context.fillStyle = color
    const firstParse = context.fillStyle
    context.fillStyle = "#040506"
    context.fillStyle = color
    if (context.fillStyle !== firstParse) {
      throw new Error(`Unsupported Monaco theme color: ${color}`)
    }

    context.clearRect(0, 0, 1, 1)
    context.fillRect(0, 0, 1, 1)
    const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data
    const byteToHex = (channel: number) => channel.toString(16).padStart(2, "0")
    return `#${byteToHex(red)}${byteToHex(green)}${byteToHex(blue)}${alpha === 255 ? "" : byteToHex(alpha)}`
  }
}

let monacoColorConverter: ReturnType<typeof createMonacoColorConverter> | undefined

function getMonacoColorConverter() {
  monacoColorConverter ??= createMonacoColorConverter()
  return monacoColorConverter
}

function getThemePalette() {
  if (typeof window === "undefined") {
    throw new Error("Monaco theme tokens are only available in the browser")
  }

  const styles = getComputedStyle(document.documentElement)
  const normalizeColor = getMonacoColorConverter()
  const read = (token: string) => {
    const value = styles.getPropertyValue(token).trim()
    if (!value) throw new Error(`Missing Monaco theme token: ${token}`)
    return normalizeColor(value)
  }

  return {
    background: read("--background"),
    foreground: read("--foreground"),
    card: read("--card"),
    muted: read("--muted"),
    mutedForeground: read("--muted-foreground"),
    border: read("--border"),
    input: read("--input"),
    accentBlue: read("--accent-blue"),
    accentGreen: read("--accent-green"),
    accentAmber: read("--accent-amber"),
    accentRed: read("--accent-red"),
    accentViolet: read("--accent-violet"),
  }
}

function configureMonacoWorkers() {
  globalThis.MonacoEnvironment = {
    getWorker(_workerId, label) {
      if (label === "json") {
        return new Worker(
          new URL("./monaco-workers/json.worker.ts", import.meta.url),
          { name: label, type: "module" }
        )
      }
      if (label === "css" || label === "scss" || label === "less") {
        return new Worker(
          new URL("./monaco-workers/css.worker.ts", import.meta.url),
          { name: label, type: "module" }
        )
      }
      if (label === "html" || label === "handlebars" || label === "razor") {
        return new Worker(
          new URL("./monaco-workers/html.worker.ts", import.meta.url),
          { name: label, type: "module" }
        )
      }
      if (label === "typescript" || label === "javascript") {
        return new Worker(
          new URL("./monaco-workers/typescript.worker.ts", import.meta.url),
          { name: label, type: "module" }
        )
      }
      return new Worker(
        new URL("./monaco-workers/editor.worker.ts", import.meta.url),
        { name: label, type: "module" }
      )
    },
  }
}

async function applyMonacoTheme(mode: MonacoThemeMode) {
  configureMonacoWorkers()
  const monaco = await import("monaco-editor")
  const palette = getThemePalette()
  const foreground = toMonacoHex(palette.foreground)
  const mutedForeground = toMonacoHex(palette.mutedForeground)
  const accentBlue = toMonacoHex(palette.accentBlue)
  const accentGreen = toMonacoHex(palette.accentGreen)
  const accentAmber = toMonacoHex(palette.accentAmber)
  const accentRed = toMonacoHex(palette.accentRed)
  const accentViolet = toMonacoHex(palette.accentViolet)

  monaco.editor.defineTheme(getMonacoThemeName(mode), {
    base: mode === "dark" ? "vs-dark" : "vs",
    inherit: true,
    rules: [
      { token: "comment", foreground: mutedForeground, fontStyle: "italic" },
      { token: "keyword", foreground: accentBlue, fontStyle: "bold" },
      { token: "operator", foreground: foreground },
      { token: "string", foreground: accentGreen },
      { token: "number", foreground: accentAmber },
      { token: "regexp", foreground: accentAmber },
      { token: "type", foreground: accentBlue },
      { token: "type.identifier", foreground: accentBlue },
      { token: "delimiter", foreground },
      { token: "tag", foreground: accentBlue },
      { token: "attribute.name", foreground: accentAmber },
      { token: "attribute.value", foreground: accentGreen },
      { token: "invalid", foreground: accentRed },
      { token: "variable.predefined", foreground: accentViolet },
    ],
    colors: {
      "editor.background": palette.background,
      "editor.foreground": palette.foreground,
      "editorCursor.foreground": palette.accentBlue,
      "editor.lineHighlightBackground": withAlpha(palette.card, mode === "dark" ? "cc" : "80"),
      "editor.lineHighlightBorder": withAlpha(palette.border, "00"),
      "editor.selectionBackground": withAlpha(palette.accentBlue, mode === "dark" ? "33" : "24"),
      "editor.inactiveSelectionBackground": withAlpha(palette.accentBlue, mode === "dark" ? "1f" : "16"),
      "editor.selectionHighlightBackground": withAlpha(palette.accentBlue, mode === "dark" ? "18" : "12"),
      "editor.wordHighlightBackground": withAlpha(palette.accentBlue, mode === "dark" ? "18" : "12"),
      "editor.wordHighlightStrongBackground": withAlpha(palette.accentBlue, mode === "dark" ? "24" : "1a"),
      "editor.findMatchBackground": withAlpha(palette.accentAmber, mode === "dark" ? "2e" : "24"),
      "editor.findMatchBorder": palette.accentAmber,
      "editor.findMatchHighlightBackground": withAlpha(palette.accentAmber, mode === "dark" ? "18" : "14"),
      "editorBracketMatch.background": withAlpha(palette.accentBlue, mode === "dark" ? "1c" : "14"),
      "editorBracketMatch.border": palette.accentBlue,
      "editorWhitespace.foreground": withAlpha(palette.border, mode === "dark" ? "66" : "8c"),
      "editorIndentGuide.background1": withAlpha(palette.border, mode === "dark" ? "66" : "8c"),
      "editorIndentGuide.activeBackground1": withAlpha(palette.accentBlue, mode === "dark" ? "8c" : "80"),
      "editorLineNumber.foreground": withAlpha(palette.mutedForeground, mode === "dark" ? "b3" : "99"),
      "editorLineNumber.activeForeground": palette.foreground,
      "editorGutter.background": palette.background,
      "editorGutter.modifiedBackground": palette.accentBlue,
      "editorGutter.addedBackground": palette.accentGreen,
      "editorGutter.deletedBackground": palette.accentRed,
      "editorOverviewRuler.border": withAlpha(palette.border, "00"),
      "scrollbarSlider.background": withAlpha(palette.border, mode === "dark" ? "8c" : "99"),
      "scrollbarSlider.hoverBackground": withAlpha(palette.mutedForeground, mode === "dark" ? "99" : "a6"),
      "scrollbarSlider.activeBackground": withAlpha(palette.accentBlue, mode === "dark" ? "99" : "8c"),
      "editorStickyScroll.background": palette.background,
      "editorStickyScrollHover.background": withAlpha(palette.card, mode === "dark" ? "f2" : "d9"),
      "editorHoverWidget.background": palette.card,
      "editorHoverWidget.border": palette.border,
      "editorWidget.background": palette.card,
      "editorWidget.border": palette.border,
      "editorError.foreground": palette.accentRed,
      "editorWarning.foreground": palette.accentAmber,
      "editorInfo.foreground": palette.accentBlue,
    },
  })

  return monaco
}

export function MonacoPane({
  value = "",
  language,
  onChange,
  readOnly = false,
  sandboxId,
  filePath,
}: Props) {
  const { resolvedTheme } = useTheme()
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const [ready, setReady] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const themeMode: MonacoThemeMode = resolvedTheme === "light" ? "light" : "dark"

  const resolvedLang = language || detectLanguage(filePath)

  // Load file from sandbox
  useEffect(() => {
    if (!sandboxId || !filePath) return

    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(
          `/api/sandbox/${sandboxId}/files?path=${encodeURIComponent(filePath)}`
        )
        if (!res.ok) throw new Error("Failed to load file")
        const { content } = await res.json()
        if (editorRef.current) {
          editorRef.current.setValue(content)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Load failed")
      } finally {
        setLoading(false)
      }
    }

    if (ready) load()
  }, [sandboxId, filePath, ready])

  // Debounced save to sandbox
  const saveToSandbox = useCallback(
    (content: string) => {
      if (!sandboxId || !filePath) return

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(async () => {
        try {
          await fetch(`/api/sandbox/${sandboxId}/files`, {
            method: "PUT",
            headers: getActiveTeamRequestHeaders({
              "Content-Type": "application/json",
            }),
            body: JSON.stringify({ path: filePath, content }),
          })
        } catch {
          // Silent fail — user can retry
        }
      }, 1000)
    },
    [sandboxId, filePath]
  )

  useEffect(() => {
    let ed: editor.IStandaloneCodeEditor | null = null
    let cancelled = false

    const init = async () => {
      const monaco = await applyMonacoTheme(themeMode)

      if (cancelled || !containerRef.current) return

      ed = monaco.editor.create(containerRef.current, {
        value,
        language: resolvedLang,
        theme: getMonacoThemeName(themeMode),
        fontFamily: "var(--font-geist-mono), 'SF Mono', monospace",
        fontSize: 13,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        readOnly,
        lineNumbers: "on",
        lineNumbersMinChars: 3,
        renderLineHighlight: "line",
        automaticLayout: true,
        smoothScrolling: true,
        cursorSmoothCaretAnimation: "on",
        padding: { top: filePath ? 8 : 12, bottom: 12 },
      })

      editorRef.current = ed
      setReady(true)

      ed.onDidChangeModelContent(() => {
        const val = ed?.getValue() || ""
        if (onChange) onChange(val)
        saveToSandbox(val)
      })
    }

    void init().catch((err) => {
      if (cancelled) return
      setError(err instanceof Error ? err.message : "Editor failed to initialize")
    })

    return () => {
      cancelled = true
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      ed?.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- editor init runs once on mount; deps are captured in closures
  }, [])

  useEffect(() => {
    if (!ready || !editorRef.current) return

    let cancelled = false

    const updateTheme = async () => {
      try {
        const monaco = await applyMonacoTheme(themeMode)
        if (cancelled || !editorRef.current) return
        monaco.editor.setTheme(getMonacoThemeName(themeMode))
        editorRef.current.getContainerDomNode().style.background =
          getThemePalette().background
        editorRef.current.layout()
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : "Editor theme failed to load")
      }
    }

    void updateTheme()

    return () => {
      cancelled = true
    }
  }, [ready, themeMode])

  useEffect(() => {
    if (ready && editorRef.current && !sandboxId && value !== editorRef.current.getValue()) {
      editorRef.current.setValue(value)
    }
  }, [value, ready, sandboxId])

  return (
    <div className="relative w-full h-full">
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-card/85 text-xs text-muted-foreground backdrop-blur-sm">
          LOADING {filePath}...
        </div>
      )}
      {error && (
        <div className="absolute left-0 right-0 top-0 z-20 border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-[10px] text-destructive backdrop-blur-sm">
          {error}
        </div>
      )}
      {filePath && (
        <div className="absolute left-0 right-0 top-0 z-10 border-b border-border/80 bg-card/88 px-3 py-1 text-[10px] text-muted-foreground backdrop-blur-sm">
          {filePath}
        </div>
      )}
      <div ref={containerRef} className={`w-full h-full ${filePath ? "pt-5" : ""}`} />
    </div>
  )
}
