import type { SVGProps } from "react"

export const MOGPLEX_MARK_PATH =
  "M9.5051 7L16 12.2381L22.4949 7L25.5 9.38095V22.7143L23.1735 25H8.82653L6.5 22.7143V9.38095L9.5051 7ZM10.8622 14.4286V19.7619L14.5459 17.0952L10.8622 14.4286ZM21.1378 14.4286V19.7619L17.4541 17.0952L21.1378 14.4286Z"

/** The mark's outer silhouette without the eye cutouts. */
export const MOGPLEX_MARK_BODY_PATH =
  "M9.5051 7L16 12.2381L22.4949 7L25.5 9.38095V22.7143L23.1735 25H8.82653L6.5 22.7143V9.38095L9.5051 7Z"

/** The mark's eye cutouts as standalone shapes (left, right). */
export const MOGPLEX_MARK_EYE_PATHS = [
  "M10.8622 14.4286V19.7619L14.5459 17.0952Z",
  "M21.1378 14.4286V19.7619L17.4541 17.0952Z",
] as const

export function MogplexMark({
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
    </svg>
  )
}
