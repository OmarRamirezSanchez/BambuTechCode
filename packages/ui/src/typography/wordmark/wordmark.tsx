import { BAMBU_WORDMARK, BAMBU_ACCENT } from "../../brand"
import { For, createUniqueId, type ComponentProps } from "solid-js"

export function Wordmark(
  props: Pick<ComponentProps<"svg">, "class"> & { fade?: boolean; muted?: boolean; outline?: boolean },
) {
  const mask = createUniqueId()
  const maskGradient = createUniqueId()

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 148.07 54.84"
      fill="none"
      classList={{
        [props.class ?? ""]: !!props.class,
        "overflow-visible [&_path]:[vector-effect:non-scaling-stroke]": props.outline,
      }}
    >
      <g opacity={props.muted === false ? 1 : 0.6} class="[[data-color-scheme=dark]_&]:opacity-100">
        <g mask={props.fade === false ? undefined : `url(#${mask})`}>
          <g
            opacity={props.muted === false ? 1 : 0.16 * 0.7}
            fill={props.outline ? "none" : "currentColor"}
            stroke={props.outline ? "currentColor" : undefined}
            stroke-width={props.outline ? 1 : undefined}
          >
            <For each={BAMBU_WORDMARK}>{(d) => <path pathLength={props.outline ? 1 : undefined} d={d} />}</For>
            <For each={BAMBU_ACCENT}>
              {(d) => (
                <path pathLength={props.outline ? 1 : undefined} d={d} fill={props.outline ? "none" : "#52D93E"} />
              )}
            </For>
          </g>
        </g>
      </g>
      <defs>
        <mask id={mask} style="mask-type:alpha" maskUnits="userSpaceOnUse" x="0" y="0" width="148.07" height="54.84">
          <rect width="148.07" height="54.84" fill={`url(#${maskGradient})`} />
        </mask>
        <linearGradient id={maskGradient} x1="74" y1="27" x2="74" y2="54.84" gradientUnits="userSpaceOnUse">
          <stop stop-color="white" stop-opacity="0.7" />
          <stop offset="1" stop-color="white" stop-opacity="0" />
        </linearGradient>
      </defs>
    </svg>
  )
}
