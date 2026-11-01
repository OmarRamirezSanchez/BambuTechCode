import { onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
export function RadAccount() {
  const language = useLanguage()
  const [state, setState] = createStore({ name: "", origin: "", error: false, pending: 0 })
  const refresh = async () => {
    const response = await fetch("/api/experimental/rad/me")
    if (response.status === 401) {
      location.reload()
      return
    }
    if (!response.ok) {
      setState("error", true)
      return
    }
    const data = await response.json()
    setState({ name: data.user.name, origin: data.radOrigin, error: false, pending: data.pending ?? 0 })
  }
  onMount(() => {
    if (import.meta.env.VITE_RAD_GOVERNANCE !== "true") return
    void refresh().catch(() => setState("error", true))
    const timer = setInterval(() => void refresh().catch(() => setState("error", true)), 30000)
    onCleanup(() => clearInterval(timer))
  })
  const logout = async () => {
    const response = await fetch("/api/experimental/rad/logout", { method: "POST" })
    if (response.ok) location.replace("/")
    else setState("error", true)
  }
  return (
    <Show when={state.name}>
      <details class="fixed right-3 top-2 z-50 rounded-lg border border-border-base bg-background-base p-2 text-12-regular shadow-lg">
        <summary class="cursor-pointer">RAD · {state.name}</summary>
        <div class="flex flex-col gap-2 p-2">
          <a href={state.origin + "/mi-actividad"} target="_blank" rel="noreferrer">
            {language.t("rad.history")}
          </a>
          <Show when={state.pending > 0}>
            <span>{language.t("rad.syncPending")}</span>
          </Show>
          <Show when={state.error}>
            <span role="alert">{language.t("rad.unavailable")}</span>
          </Show>
          <button onClick={() => void logout()}>{language.t("rad.logout")}</button>
        </div>
      </details>
    </Show>
  )
}
