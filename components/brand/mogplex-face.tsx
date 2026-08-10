import type { SVGProps } from "react"
import { MOGPLEX_MARK_PATH } from "./mogplex-mark"

/**
 * The Mogplex mark as a living face: two pupils inside the mark's eye
 * cutouts drift through a look-around cycle (see the `mogplex-look`
 * keyframes in globals.css). Rendered bare — no wrapper, no background —
 * so it can sit anywhere the brand should feel alive (loading states,
 * hero sections, assistant headers).
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
        <circle cx="12.15" cy="17.1" r="1.15" />
        <circle cx="19.85" cy="17.1" r="1.15" />
      </g>
    </svg>
  )
}
