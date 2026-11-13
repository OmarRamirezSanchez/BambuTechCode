import { onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"

/**
 * The RAD session of a governed BambuTechCode: who signed in, the BambuIAFrameWork connection and the history still
 * to copy to RAD. The desktop's main process holds the session; on the web, the RAD gateway on this origin does.
 */
export function createRadAccount() {
  const platform = usePlatform()

  const [state, setState] = createStore({
    governed: platform.rad ? false : import.meta.env.VITE_RAD_GOVERNANCE === "true",
    name: "",
    email: "",
    origin: "",
    framework: "",
    pending: 0,
    error: false,
  })

  const refresh = async () => {
    if (platform.rad) {
      const data = await platform.rad.status()
      setState({
        governed: data.governed,
        name: data.name ?? "",
        email: data.email ?? "",
        origin: data.radOrigin ?? "",
        framework: data.framework ?? "",
        pending: data.pending,
        error: data.error,
      })

      return
    }

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
    setState({
      name: data.user.name,
      email: data.user.email ?? "",
      origin: data.radOrigin,
      framework: data.framework ?? "",
      pending: data.pending ?? 0,
      error: false,
    })
  }

  onMount(() => {
    if (!platform.rad && import.meta.env.VITE_RAD_GOVERNANCE !== "true") return
    void refresh().catch(() => setState("error", true))
    const timer = setInterval(() => void refresh().catch(() => setState("error", true)), 30000)
    onCleanup(() => clearInterval(timer))
  })

  return {
    state,
    refresh,
    history: () => platform.openExternal(state.origin + "/mi-actividad"),
    logout: async () => {
      if (platform.rad) return platform.rad.logout()
      const response = await fetch("/api/experimental/rad/logout", { method: "POST" })

      if (response.ok) location.replace("/")
      else setState("error", true)
    },
  }
}

export function RadAccount() {
  const language = useLanguage()
  const account = createRadAccount()

  return (
    <Show when={account.state.name}>
      <details class="fixed right-3 top-2 z-50 rounded-lg border border-border-base bg-background-base p-2 text-12-regular shadow-lg">
        <summary class="cursor-pointer">RAD · {account.state.name}</summary>
        <div class="flex flex-col gap-2 p-2">
          <a
            href={account.state.origin + "/mi-actividad"}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => {
              event.preventDefault()
              account.history()
            }}
          >
            {language.t("rad.history")}
          </a>
          <Show when={account.state.pending > 0}>
            <span>{language.t("rad.syncPending")}</span>
          </Show>
          <Show when={account.state.error}>
            <span role="alert">{language.t("rad.unavailable")}</span>
          </Show>
          <button onClick={() => void account.logout()}>{language.t("rad.logout")}</button>
        </div>
      </details>
    </Show>
  )
}
