import type { SVGProps } from "react"
import { cn } from "@/lib/utils"
import {
  MOGPLEX_MARK_BODY_PATH,
  MOGPLEX_MARK_EYE_PATHS,
} from "./mogplex-mark"

/**
 * How the face is currently feeling. Hosts map their own state onto a mood:
 * `idle` drifts through a look-around cycle with occasional blinks,
 * `listening` fixes its gaze on the input while the user types,
 * `thinking` squints and scans while the assistant is working.
 */
export type MogplexFaceMood = "idle" | "listening" | "thinking"

/* Alternate pupil shapes, centered on the triangle eyes' centroids so the
   swap doesn't shift the gaze. Sized to match the triangles' visual weight. */
const EYE_CIRCLES = [
  { cx: 12.09, cy: 17.1 },
  { cx: 19.91, cy: 17.1 },
] as const
const EYE_SQUARES = [{ x: 10.54 }, { x: 18.36 }] as const

/**
 * The Mogplex mark as a living face: the eyes are drawn on top of the mark's
 * solid silhouette in the background color (see `.mogplex-face-*` in
 * globals.css), so they read as dark filled pupils. The pupils hatch in on
 * mount, blink on a slow cycle, occasionally shape-shift between triangles,
 * circles, and squares (each swap hidden inside a blink), and change
 * behavior with `mood`. All motion is CSS-driven and disabled under
 * prefers-reduced-motion. Rendered bare — no wrapper, no background — so it
 * can sit anywhere the brand should feel alive (loading states, hero
 * sections, assistant headers).
 */
export function MogplexFace({
  className,
  mood = "idle",
  ...rest
}: Omit<SVGProps<SVGSVGElement>, "viewBox" | "xmlns" | "fill"> & {
  mood?: MogplexFaceMood
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      data-mood={mood}
      className={cn("mogplex-face", className)}
      {...rest}
    >
      <path d={MOGPLEX_MARK_BODY_PATH} />
      <g className="mogplex-face-pupils">
        <g className="mogplex-face-lids">
          <g className="mogplex-eyes-tri">
            {MOGPLEX_MARK_EYE_PATHS.map((d) => (
              <path key={d} d={d} />
            ))}
          </g>
          <g className="mogplex-eyes-circle">
            {EYE_CIRCLES.map((c) => (
              <circle key={c.cx} cx={c.cx} cy={c.cy} r={1.8} />
            ))}
          </g>
          <g className="mogplex-eyes-square">
            {EYE_SQUARES.map((s) => (
              <rect key={s.x} x={s.x} y={15.55} width={3.1} height={3.1} />
            ))}
          </g>
        </g>
      </g>
    </svg>
  )
}
