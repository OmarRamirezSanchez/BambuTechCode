import { Schema } from "effect"
import { BambuIA } from "@opencode/core/plugin/provider/bambu-ia"

type Request = (method: string, endpoint: string, value?: unknown) => Promise<Response>
type Credential = {
  id: string
  integrationID: string
  value: { type: string; refresh?: string; metadata?: { consoleID?: string } }
}

/**
 * Connects one governed runtime to BambuIAFrameWork. Each RAD sign-in becomes the runtime's Framework console; the
 * core plugin renews it from then on, so the RAD token itself never reaches the runtime.
 */
export function frameworkLink(request: Request) {
  const framework = BambuIA.origin()
  const state = { linked: undefined as string | undefined, retry: 0, queue: Promise.resolve() }
  const consoles = async () =>
    ((await (await request("GET", "/api/credential")).json()) as { data: Credential[] }).data.filter(
      (item) => item.integrationID === BambuIA.integrationID,
    )
  const link = async (token: string) => {
    if (!framework || state.linked === token || state.retry > Date.now()) return
    const previous = await consoles()
    const response = await fetch(framework + "/auth/exchange", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ consoleName: "BambuTechCode", consoleId: previous.at(-1)?.value.metadata?.consoleID }),
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) throw Object.assign(Error("BambuIAFrameWork unavailable"), { status: response.status })
    const session = Schema.decodeUnknownSync(BambuIA.Session)(((await response.json()) as { data: unknown }).data)
    await request("POST", "/api/credential", {
      integrationID: BambuIA.integrationID,
      label: session.user.email,
      value: BambuIA.credential(session),
    })
    for (const item of previous) await request("DELETE", "/api/credential/" + item.id)
    state.linked = token
  }
  return {
    // One exchange at a time; a failure waits before the next request tries again.
    sync: (token: string) => {
      state.queue = state.queue
        .then(() => link(token))
        .catch(() => {
          state.retry = Date.now() + 30000
        })
      return state.queue
    },
    status: (token: string) => {
      if (!framework) return "disabled"
      if (state.linked === token) return "connected"
      // Until the first exchange finishes, or until the next retry, the runtime is still connecting.
      if (state.retry > Date.now()) return "unavailable"
      return "connecting"
    },
    // Closes the console in the Framework and removes it from the runtime.
    unlink: async () => {
      if (!framework) return
      state.queue = state.queue
        .then(async () => {
          for (const item of await consoles()) {
            await fetch(framework + "/auth/logout", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ refreshToken: item.value.refresh }),
              redirect: "error",
              signal: AbortSignal.timeout(15000),
            }).catch(() => undefined)
            await request("DELETE", "/api/credential/" + item.id)
          }
          state.linked = undefined
        })
        .catch(() => undefined)
      await state.queue
    },
  }
}
