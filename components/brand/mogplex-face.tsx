import type { SVGProps } from "react"
import { MOGPLEX_MARK_PATH } from "./mogplex-mark"

/**
 * The Mogplex mark as a living face: the mark's triangular eye cutouts are
 * filled with slightly inset triangles that drift through a look-around
 * cycle (see the `mogplex-look` keyframes in globals.css). The inset leaves
 * a thin background rim so the eyes read as solid shapes whose gaze shifts.
 * Rendered bare — no wrapper, no background — so it can sit anywhere the
 * brand should feel alive (loading states, hero sections, assistant
 * headers).
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
      <path fillRule="evenodd" clipRule="evenodd" d={MOGPLEX_MARK_PATH} />
      <g className="mogplex-face-pupils">
        <path d="M11.08 14.91V19.28L14.1 17.1Z" />
        <path d="M20.92 14.91V19.28L17.9 17.1Z" />
      </g>
    </svg>
  )
}
