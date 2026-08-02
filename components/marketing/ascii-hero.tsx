"use client"
import { useEffect, useRef, useState } from "react"
import { ALIEN_MASK, MOGPLEX_SWIRL_TEXT } from "./mogplex-ascii"

// Cap the offscreen backing store at 2× DPR. At 3× on a 4K display the
// per-frame texImage2D upload balloons to ~75MP; 2× keeps things crisp
// without turning the hero into a thermal event on high-density panels.
const MAX_DPR = 2

const VERTEX_SRC = `#version 300 es
in vec4 aVertexPosition;
in vec2 aTextureCoord;
out vec2 vTextureCoord;
void main() {
  gl_Position = aVertexPosition;
  vTextureCoord = aTextureCoord;
}
`

// Calm CRT: settles quickly into a steady barrel, tiny steady chroma shift,
// slow subtle scanlines. The motion should feel like looking at an old
// terminal, not a music video.
const FRAGMENT_SRC = `#version 300 es
precision highp float;
in vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform float uTime;
uniform vec2 uResolution;
out vec4 fragColor;

float easeOutCubic(float t) { float u = 1.0 - t; return 1.0 - u * u * u; }

void main() {
  vec2 uv = vTextureCoord;

  float curvProgress = min(uTime / 1800.0, 1.0);
  float curv = easeOutCubic(curvProgress);

  vec2 cuv = uv * 2.0 - 1.0;
  cuv *= 1.0 + 0.05 * curv;
  cuv *= 1.0 - (0.045 * curv) + (0.025 * curv) * pow(abs(cuv.yx), vec2(2.0));
  cuv = cuv * 0.5 + 0.5;

  if (cuv.x < 0.0 || cuv.x > 1.0 || cuv.y < 0.0 || cuv.y > 1.0) {
    fragColor = vec4(0.0);
    return;
  }

  // Very small steady chroma shift — just a whisper of a CRT.
  float chroma = 0.0015;
  float r = texture(uSampler, vec2(cuv.x + chroma, cuv.y)).r;
  float g = texture(uSampler, cuv).g;
  float b = texture(uSampler, vec2(cuv.x - chroma, cuv.y)).b;
  vec4 tex = vec4(r, g, b, 1.0);

  // Slow, quiet scanlines.
  float scanline = max(0.0, sin((cuv.y + uTime * 0.0000003) * uResolution.y * 1.2)) * 0.35;
  tex.rgb = mix(tex.rgb, tex.rgb - vec3(scanline), 0.3);

  // Warm the red/blue channels a touch for a violet bias.
  tex.rgb *= vec3(1.02, 0.98, 1.06);

  // Soft vignette.
  float vign = 1.0 - length(cuv - 0.5) * 0.75;
  tex.rgb *= vign;

  // Brightness lift + soft-clip.
  tex.rgb *= 2.0;
  tex.rgb = 1.0 - exp(-tex.rgb);

  fragColor = tex;
}
`

function compileShader(gl: WebGL2RenderingContext, type: number, src: string) {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, src)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("shader compile failed:", gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function linkProgram(gl: WebGL2RenderingContext, vs: WebGLShader, fs: WebGLShader) {
  const program = gl.createProgram()
  if (!program) return null
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("program link failed:", gl.getProgramInfoLog(program))
    gl.deleteProgram(program)
    return null
  }
  return program
}

const SWIRL_ROWS = MOGPLEX_SWIRL_TEXT.split("\n").map((r) => r.replace(/\t/g, "    "))

const STATIC_ALIEN = ALIEN_MASK.map((row) =>
  row.replaceAll(".", " ").replaceAll("X", "@"),
).join("\n")

function easeOutCubic(t: number) {
  const u = 1 - t
  return 1 - u * u * u
}
function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v
}

type AlienPlacement = {
  rowStart: number
  colStart: number
  rows: number
  cols: number
}

// Vertical bias for the alien within the hero canvas. The headline lives
// below the canvas in the DOM, so we keep the alien in the upper-middle
// band rather than dead-center to leave breathing room beneath it.
const ALIEN_ROW_BIAS = 0.18
// Share of grid height the alien is allowed to occupy. Tuned so the alien
// reads as a poster element without dominating tall viewports.
const ALIEN_ROW_BUDGET = 0.62
const ALIEN_COL_BUDGET = 0.58

// Sample the charset as a straight scrolling wall of text. Each grid row
// maps to one charset line; a slow vertical offset ticks the whole block up
// over time, and a gentle horizontal drift keeps cells from locking into a
// pattern. No rotation.
function sampleStraightChar(
  row: number,
  col: number,
  timeOffset: number,
): string {
  const charsetRowCount = SWIRL_ROWS.length
  const rowIdx = ((row + Math.floor(timeOffset)) % charsetRowCount + charsetRowCount) % charsetRowCount
  const charsetRow = SWIRL_ROWS[rowIdx]
  const maxCol = charsetRow.length
  if (maxCol === 0) return " "
  const colIdx = ((col + Math.floor(timeOffset * 0.4)) % maxCol + maxCol) % maxCol
  return charsetRow[colIdx] ?? " "
}

// Map (col, row) in the character grid to the native alien mask; return true
// if that grid cell lands on a solid pixel. Grid coverage is ~90% vertical
// with the alien's native 11×8 aspect preserved (11/8 = 1.375 wide).
function isInsideAlien(
  col: number,
  row: number,
  placement: AlienPlacement,
): boolean {
  const relRow = row - placement.rowStart
  const relCol = col - placement.colStart
  if (relRow < 0 || relRow >= placement.rows) return false
  if (relCol < 0 || relCol >= placement.cols) return false
  const maskRow = Math.floor((relRow / placement.rows) * ALIEN_MASK.length)
  const maskCol = Math.floor((relCol / placement.cols) * ALIEN_MASK[0].length)
  const row0 = ALIEN_MASK[maskRow] ?? ""
  return row0[maskCol] === "X"
}

// Dense fill chars substituted when the text sample is a space — keeps the
// silhouette solid without washing out the readable content. Wider palette,
// heavier on mid-density glyphs so the body reads as fabric, not confetti.
const FILL_CHARS = "▒░▒·▓·▒░·▒▓░"

function buildRowLines(
  row: number,
  cols: number,
  timeOffset: number,
  placement: AlienPlacement,
): { alienLine: string; alienStartCol: number } {
  let alienLine = ""
  let alienStartCol = -1
  let trailingSpaces = 0

  for (let col = 0; col < cols; col++) {
    if (!isInsideAlien(col, row, placement)) {
      if (alienStartCol >= 0) trailingSpaces += 1
      continue
    }
    let ch = sampleStraightChar(row, col, timeOffset)
    if (ch === " ") {
      const idx = (row * 31 + col * 17) % FILL_CHARS.length
      ch = FILL_CHARS[(idx + FILL_CHARS.length) % FILL_CHARS.length]
    }
    if (alienStartCol < 0) alienStartCol = col
    if (trailingSpaces > 0) {
      alienLine += " ".repeat(trailingSpaces)
      trailingSpaces = 0
    }
    alienLine += ch
  }

  return { alienLine, alienStartCol }
}

// Size the alien silhouette to occupy a comfortable share of the canvas
// without crowding the headline that sits below it in the DOM. The native
// 11×8 mask aspect is preserved by accounting for the character cell being
// taller than wide.
function computeLayout(
  gridCols: number,
  gridRows: number,
  charAspect: number,
): { alien: AlienPlacement } {
  const maskCols = ALIEN_MASK[0].length
  const maskRows = ALIEN_MASK.length
  const ratio = (maskCols / maskRows) * charAspect

  const budgetCols = Math.floor(gridCols * ALIEN_COL_BUDGET)
  const budgetRows = Math.max(maskRows, Math.floor(gridRows * ALIEN_ROW_BUDGET))

  let alienCols = Math.floor(budgetRows * ratio)
  let alienRows = budgetRows
  if (alienCols > budgetCols) {
    alienCols = budgetCols
    alienRows = Math.max(maskRows, Math.floor(alienCols / ratio))
  }

  const rowStart = Math.max(1, Math.floor(gridRows * ALIEN_ROW_BIAS))

  return {
    alien: {
      rowStart,
      colStart: Math.max(0, Math.floor((gridCols - alienCols) / 2)),
      rows: alienRows,
      cols: alienCols,
    },
  }
}

// Paint a single frame of the ASCII scene to the offscreen 2D canvas.
// (cssW,cssH) are CSS pixels; dpr scales the actual backing store.
function drawAsciiFrame(
  canvas: HTMLCanvasElement,
  dpr: number,
  cssW: number,
  cssH: number,
  elapsed: number,
  backgroundColor: string,
  foregroundColor: string,
) {
  const ctx = canvas.getContext("2d")
  if (!ctx) return

  // Slow vertical tick of the text — one line every ~2 seconds.
  const timeOffset = elapsed * 0.0005
  const fadeIn = easeOutCubic(clamp(elapsed * 0.0008, 0, 1))

  const w = cssW * dpr
  const h = cssH * dpr
  // Avoid the implicit context-state reset that `canvas.width = …` triggers
  // unless the backing store actually needs to change size.
  if (canvas.width !== w) canvas.width = w
  if (canvas.height !== h) canvas.height = h
  canvas.style.width = `${cssW}px`
  canvas.style.height = `${cssH}px`

  ctx.fillStyle = backgroundColor
  ctx.fillRect(0, 0, w, h)

  const rowsInCharset = SWIRL_ROWS.length
  const rawRowHeight = Math.floor(h / rowsInCharset)
  const fontSize = Math.max(1, Math.round(rawRowHeight * 1.3))
  const yOffset = Math.round((h - rowsInCharset * fontSize) / 2)

  const fontStack = `${fontSize}px ui-monospace, 'SF Mono', Menlo, Consolas, monospace`
  ctx.font = fontStack
  ctx.textBaseline = "top"
  const charWidth = ctx.measureText("M").width
  const cols = Math.floor(w / charWidth)
  const charAspect = fontSize / charWidth

  const { alien } = computeLayout(cols, rowsInCharset, charAspect)

  ctx.fillStyle = foregroundColor
  ctx.globalAlpha = fadeIn
  ctx.font = `bold ${fontStack}`

  for (let row = 0; row < rowsInCharset; row++) {
    const { alienLine, alienStartCol } = buildRowLines(
      row,
      cols,
      timeOffset,
      alien,
    )
    if (alienStartCol < 0) continue
    const y = yOffset + row * fontSize
    ctx.fillText(alienLine, alienStartCol * charWidth, y)
  }
  ctx.globalAlpha = 1
}

export function AsciiHero() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  // Pre-GL-15 Safari, some Android WebViews, and WebGL-blocking privacy
  // browsers hit this path. A static gradient reads as "intentionally quiet"
  // rather than a broken hero.
  const [unsupported, setUnsupported] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: false })
    if (!gl) {
      setUnsupported(true)
      return
    }

    const offscreen = document.createElement("canvas")
    const styles = getComputedStyle(canvas)
    const backgroundColor = styles
      .getPropertyValue("--ascii-hero-background")
      .trim()
    const foregroundColor = styles
      .getPropertyValue("--ascii-hero-foreground")
      .trim()
    if (!backgroundColor || !foregroundColor) {
      setUnsupported(true)
      return
    }

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SRC)
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC)
    if (!vs || !fs) return
    const program = linkProgram(gl, vs, fs)
    if (!program) return

    const aVertexPosition = gl.getAttribLocation(program, "aVertexPosition")
    const aTextureCoord = gl.getAttribLocation(program, "aTextureCoord")
    const uSampler = gl.getUniformLocation(program, "uSampler")
    const uTime = gl.getUniformLocation(program, "uTime")
    const uResolution = gl.getUniformLocation(program, "uResolution")

    const posBuf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, 1, 1, 1, -1, -1, 1, -1]),
      gl.STATIC_DRAW,
    )

    const uvBuf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
      gl.STATIC_DRAW,
    )

    const texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

    const motionQuery =
      typeof window !== "undefined"
        ? window.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null
        : null
    let reducedMotion = motionQuery?.matches ?? false

    let startTime = 0
    let rafId: number | null = null

    const scheduleFrame = () => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(tick)
    }

    const tick = (now: number) => {
      rafId = null
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
      if (startTime === 0) startTime = now
      const elapsed = reducedMotion ? 8000 : now - startTime

      drawAsciiFrame(
        offscreen,
        dpr,
        rect.width,
        rect.height,
        elapsed,
        backgroundColor,
        foregroundColor,
      )

      const pw = Math.max(1, Math.floor(rect.width * dpr))
      const ph = Math.max(1, Math.floor(rect.height * dpr))
      if (canvas.width !== pw) canvas.width = pw
      if (canvas.height !== ph) canvas.height = ph

      gl.viewport(0, 0, pw, ph)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        offscreen,
      )

      gl.useProgram(program)
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf)
      gl.vertexAttribPointer(aVertexPosition, 2, gl.FLOAT, false, 0, 0)
      gl.enableVertexAttribArray(aVertexPosition)
      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf)
      gl.vertexAttribPointer(aTextureCoord, 2, gl.FLOAT, false, 0, 0)
      gl.enableVertexAttribArray(aTextureCoord)
      gl.uniform1i(uSampler, 0)
      gl.uniform1f(uTime, elapsed)
      gl.uniform2f(uResolution, pw, ph)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

      if (!reducedMotion) scheduleFrame()
    }
    scheduleFrame()

    // In reduced-motion mode we only draw once, so a layout change would
    // otherwise leave the hero stretched. Observe the canvas and re-render
    // on resize; the animated path already repaints every frame.
    const resizeObserver = new ResizeObserver(() => {
      if (reducedMotion) scheduleFrame()
    })
    resizeObserver.observe(canvas)

    // Respond to the user toggling their OS motion preference mid-session.
    const onMotionChange = (event: MediaQueryListEvent) => {
      const wasReduced = reducedMotion
      reducedMotion = event.matches
      if (wasReduced && !reducedMotion) {
        startTime = 0
        scheduleFrame()
      } else if (!wasReduced && reducedMotion) {
        scheduleFrame()
      }
    }
    motionQuery?.addEventListener?.("change", onMotionChange)

    // WebGL contexts can be lost at any time (tab backgrounding, driver
    // crash, resource pressure). Without this, the rAF loop keeps burning
    // CPU on a dead pipeline where every gl call is a no-op.
    const onContextLost = (event: Event) => {
      event.preventDefault()
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
    }
    const onContextRestored = () => {
      // Shaders/buffers/textures were destroyed with the context. Rather
      // than rebuild inline, fall back to the static hero — rare enough
      // that the simpler code path is worth it.
      setUnsupported(true)
    }
    canvas.addEventListener("webglcontextlost", onContextLost)
    canvas.addEventListener("webglcontextrestored", onContextRestored)

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      resizeObserver.disconnect()
      motionQuery?.removeEventListener?.("change", onMotionChange)
      canvas.removeEventListener("webglcontextlost", onContextLost)
      canvas.removeEventListener("webglcontextrestored", onContextRestored)
      gl.deleteTexture(texture)
      gl.deleteBuffer(posBuf)
      gl.deleteBuffer(uvBuf)
      gl.deleteProgram(program)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
    }
  }, [])

  if (unsupported) {
    return (
      <div
        aria-label="Mogplex"
        role="img"
        className="ascii-hero ascii-hero-fallback relative h-full w-full overflow-hidden"
      >
        <div className="ascii-hero-fallback-mark absolute left-1/2 top-[18%] w-[min(86vw,900px)] -translate-x-1/2 text-center font-mono font-bold leading-none text-violet-200/40">
          <pre className="text-[clamp(13px,2.7vw,34px)] leading-[0.7]">
            {STATIC_ALIEN}
          </pre>
        </div>
      </div>
    )
  }

  return (
    <canvas
      ref={canvasRef}
      aria-label="Mogplex"
      role="img"
      className="ascii-hero"
      style={{ width: "100%", height: "100%", background: "transparent" }}
    />
  )
}
