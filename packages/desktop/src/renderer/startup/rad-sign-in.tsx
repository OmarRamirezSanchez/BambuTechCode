import { useLanguage } from "@opencode/app/desktop"
import { onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { ElectronAPI } from "../api-types"

/**
 * Governed builds wait for the member's RAD sign-in, which happens in the system browser. While the startup splash is
 * up, this tells the member where to continue and lets them reopen the page.
 */
export function RadSignIn(props: { api: ElectronAPI }) {
  const language = useLanguage()
  const [state, setState] = createStore({ stage: "" })
  onMount(() => {
    const poll = () =>
      void props.api
        .radStatus()
        .then((status) => setState("stage", status.governed ? status.stage : ""))
        .catch(() => undefined)

    poll()
    const timer = setInterval(poll, 1000)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <Show when={state.stage === "signing-in" || state.stage === "starting"}>
      <div class="fixed inset-x-0 bottom-16 z-[101] flex justify-center px-4">
        <div class="flex max-w-md flex-col items-center gap-3 rounded-lg border border-border-base bg-background-base p-5 text-center shadow-lg">
          <Show
            when={state.stage === "signing-in"}
            fallback={<p class="text-14-regular text-text-base">{language.t("rad.desktop.starting")}</p>}
          >
            <p class="text-14-medium text-text-strong">{language.t("rad.desktop.signIn")}</p>
            <p class="text-13-regular text-text-base">{language.t("rad.desktop.signInDescription")}</p>
            <button
              class="rounded-md border border-border-base px-3 py-1.5 text-13-medium"
              onClick={() => void props.api.radOpenLogin()}
            >
              {language.t("rad.desktop.openSignIn")}
            </button>
          </Show>
        </div>
      </div>
    </Show>
  )
}
