import type { SVGProps } from "react"

export const MOGPLEX_MARK_PATH =
  "M16.0002 26.6667L10.667 32L0 21.3335L5.33326 15.9998L16.0002 26.6667ZM32.0005 21.3335L21.3335 32L16.0002 26.6667L26.6667 15.9998L32.0005 21.3335ZM16.0002 5.33326L5.33326 15.9998L0.000460359 10.667L10.667 0L16.0002 5.33326ZM32.0005 10.6665L26.6667 15.9998L16.0002 5.33326L21.3335 0L32.0005 10.6665Z"

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
      <path d={MOGPLEX_MARK_PATH} />
    </svg>
  )
}
