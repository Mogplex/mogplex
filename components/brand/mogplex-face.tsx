import type { SVGProps } from "react"
import {
  MOGPLEX_MARK_BODY_PATH,
  MOGPLEX_MARK_EYE_PATHS,
} from "./mogplex-mark"

/**
 * The Mogplex mark as a living face: the eyes are drawn on top of the mark's
 * solid silhouette in the background color (see `.mogplex-face-pupils` in
 * globals.css), so they read as dark filled pupils that drift through a
 * look-around cycle (the `mogplex-look` keyframes). Rendered bare — no
 * wrapper, no background — so it can sit anywhere the brand should feel
 * alive (loading states, hero sections, assistant headers).
 */
export function MogplexFace({
  className,
  ...rest
}: Omit<SVGProps<SVGSVGElement>, "viewBox" | "xmlns" | "fill">) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      className={className}
      {...rest}
    >
      <path d={MOGPLEX_MARK_BODY_PATH} />
      <g className="mogplex-face-pupils">
        {MOGPLEX_MARK_EYE_PATHS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </svg>
  )
}
