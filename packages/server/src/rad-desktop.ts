import { createHash, randomUUID } from "node:crypto"
import path from "node:path"
import { createInterface } from "node:readline"
import { BambuIA } from "@opencode/core/plugin/provider/bambu-ia"
import { frameworkLink } from "./rad-framework"
import { radAuthApi, radRefresh, type RadSession } from "./rad-login"
import { radRuntime } from "./rad-runtime"
import { radCall } from "./rad-sync"

type Identity = { id: number; name: string; email: string }

/**
 * The governed runtime of one desktop member. The desktop signs the member in and hands over their RAD session; this
 * process opens the member's own history, links BambuIAFrameWork and copies work sessions to RAD, like the web
 * gateway does. It renews the RAD session when its access token expires and reports the new one through `onSession`.
 */
export async function radDesktop(config: {
  api: string
  data: string
  session: RadSession
  onSession?: (session: RadSession) => void
}) {
  if (!/^https:/.test(config.api) && !["localhost", "127.0.0.1"].includes(new URL(config.api).hostname))
    throw Error("RAD API requires HTTPS")
  const auth = radAuthApi(config.api)
  const current = { session: config.session }
  const call = () => radCall(config.api, current.session.token)
  const me = () =>
    call()<Identity>("/me").catch(async (error: { status?: number }) => {
      if (error.status !== 401) throw error
      current.session = await radRefresh(auth, current.session).catch((cause: { status?: number }) => {
        // RAD answering at all means it refused the refresh token: the session is over.
        throw cause.status ? Object.assign(Error("RAD session ended"), { status: 401 }) : cause
      })
      config.onSession?.(current.session)
      return call()<Identity>("/me")
    })
  const user = await me()
  await call()("/logins", { id: randomUUID() })
  // Same layout as the web gateway: an environment change gets a separate history, even when user ids overlap.
  const issuer = createHash("sha256").update(config.api).digest("hex").slice(0, 16)
  const runtime = await radRuntime(path.join(config.data, issuer, String(user.id)), {
    governed: Boolean(BambuIA.origin()),
  })
  const framework = frameworkLink(runtime.request)
  // The app opens while the console is exchanged; the governed policy offers no other provider meanwhile.
  void framework.sync(current.session.token)
  return {
    url: runtime.origin,
    password: runtime.password,
    user,
    status: () => ({
      framework: framework.status(current.session.token),
      pending:
        runtime.journal.journal.query<{ count: number }, []>("SELECT count(*) count FROM pending").get()?.count ?? 0,
    }),
    // Copies pending work sessions to RAD and retries a failed Framework link. Unsent sessions stay in the journal.
    tick: async () => {
      await framework.sync(current.session.token)
      await runtime.journal.flush(runtime.core, call()).catch(() => undefined)
    },
    // Only RAD refusing the session ends it; RAD being unreachable does not.
    signedIn: () =>
      me().then(
        () => true,
        (error: { status?: number }) => error.status !== 401,
      ),
    logout: async () => {
      await runtime.journal.flush(runtime.core, call()).catch(() => undefined)
      await framework.unlink()
    },
    close: runtime.close,
  }
}

/**
 * Line-delimited JSON over stdio for the desktop app. The first input line carries the RAD session, so it never
 * appears in the environment that tools inherit. Closing stdin stops the runtime.
 */
export async function serveRadDesktop() {
  const api = process.env.RAD_USAGE_API,
    data = process.env.RAD_CODE_DATA
  if (!api || !data) throw Error("RAD_USAGE_API and RAD_CODE_DATA are required")
  const send = (value: Record<string, unknown>) => process.stdout.write(JSON.stringify(value) + "\n")
  const lines = createInterface({ input: process.stdin })[Symbol.asyncIterator]()
  const first = await lines.next()
  const session = first.done ? undefined : (JSON.parse(first.value) as Partial<RadSession>)
  if (typeof session?.token !== "string" || typeof session.refreshToken !== "string")
    throw Error("RAD session required on stdin")
  const desktop = await radDesktop({
    api,
    data,
    session: { token: session.token, refreshToken: session.refreshToken },
    onSession: (renewed) => send({ type: "session", ...renewed }),
  }).catch((error: { status?: number }) => {
    send({ type: "error", status: error.status ?? 503 })
    throw error
  })
  send({ type: "ready", url: desktop.url, password: desktop.password, user: desktop.user })
  const report = { last: "", ticks: 0 }
  const timer = setInterval(() => {
    void (async () => {
      await desktop.tick()
      // Checking the RAD session once a minute is enough; every tick already talks to RAD when work is pending.
      if (++report.ticks % 12 === 0 && !(await desktop.signedIn())) send({ type: "signedOut" })
      const status = desktop.status()
      if (JSON.stringify(status) === report.last) return
      report.last = JSON.stringify(status)
      send({ type: "status", ...status })
    })()
  }, 5000)
  for (let next = await lines.next(); !next.done; next = await lines.next()) {
    if ((JSON.parse(next.value) as { type?: unknown }).type !== "logout") continue
    clearInterval(timer)
    await desktop.logout()
    send({ type: "loggedOut" })
    break
  }
  clearInterval(timer)
  await desktop.close()
}
