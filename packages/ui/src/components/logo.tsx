import { BAMBU_WORDMARK, BAMBU_ACCENT } from "../brand"
import { For, type ComponentProps } from "solid-js"

// Geometry from the official BambuTechServices wordmark. Provider logos stay separate.
const Glyph = () => (
  <g transform="translate(-125, 3)" fill="#52D93E">
    <For each={BAMBU_ACCENT}>{(d) => <path d={d} />}</For>
  </g>
)

export const Mark = (props: { class?: string }) => (
  <svg
    data-component="logo-mark"
    class={props.class}
    viewBox="0 0 26 20"
    fill="none"
    aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg"
  >
    <Glyph />
  </svg>
)

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => (
  <svg
    ref={props.ref}
    data-component="logo-splash"
    class={props.class}
    viewBox="0 0 26 20"
    fill="none"
    aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg"
  >
    <Glyph />
  </svg>
)

export const Logo = (props: { class?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 148.07 54.84" class={props.class} aria-hidden="true">
    <g fill="var(--icon-strong-base, currentColor)">
      <For each={BAMBU_WORDMARK}>{(d) => <path d={d} />}</For>
    </g>
    <g fill="#52D93E">
      <For each={BAMBU_ACCENT}>{(d) => <path d={d} />}</For>
    </g>
  </svg>
)
