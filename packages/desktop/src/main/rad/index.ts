export * as Rad from "./index"

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { randomUUID } from "node:crypto"
import { createServer, type IncomingMessage } from "node:http"
import type { AddressInfo } from "node:net"
import path from "node:path"
import { createInterface } from "node:readline"
import { Option, Schema } from "effect"
import { radSignInPage } from "@opencode/ui/rad-sign-in"
import { app, safeStorage, shell } from "electron"
import type { SidecarCredentials } from "../service/sidecar-credentials"
import { RAD_SESSION_KEY } from "../storage/keys"
import { getStore } from "../storage/store"

const web = import.meta.env.RAD_WEB_ORIGIN

const api = import.meta.env.RAD_USAGE_API

const framework = import.meta.env.BAMBU_IA_ORIGIN

const firebase = import.meta.env.RAD_FIREBASE_CONFIG

// RAD's API root; its usage API lives under it.
const auth = import.meta.env.RAD_API_URL || api?.replace(/\/projects\/usage\/?$/, "")

/** A build with RAD origins is governed: members sign in with Google as RAD members and use BambuIAFrameWork. */
export const governed = Boolean(web && api && firebase)

const Identity = Schema.Struct({ id: Schema.Number, name: Schema.String, email: Schema.String })

const Session = Schema.Struct({ token: Schema.String, refreshToken: Schema.String })

const LoginResponse = Schema.Struct({
  data: Schema.Struct({ tokens: Schema.Struct({ accessToken: Schema.String, refreshToken: Schema.String }) }),
})

const Message = Schema.fromJsonString(
  Schema.Struct({
    type: Schema.String,
    url: Schema.optional(Schema.String),
    password: Schema.optional(Schema.String),
    user: Schema.optional(Identity),
    status: Schema.optional(Schema.Number),
    framework: Schema.optional(Schema.String),
    pending: Schema.optional(Schema.Number),
    token: Schema.optional(Schema.String),
    refreshToken: Schema.optional(Schema.String),
  }),
)

export type Status = {
  governed: boolean
  radOrigin?: string
  stage: "signed-out" | "signing-in" | "starting" | "ready"
  user?: typeof Identity.Type
  framework?: string
  pending: number
  // RAD ended the session while the app was open; signing out and in again restores it.
  expired: boolean
}

// The page waiting for a sign-in, and the member's running runtime with its connection details.
type State = {
  status: Status
  login?: string
  child?: ChildProcessWithoutNullStreams
  ready?: SidecarCredentials.Data
}

const state: State = { status: { governed, radOrigin: web, stage: "signed-out", pending: 0, expired: false } }

export const status = () => state.status

/** Reopens the sign-in page in the browser while the app waits for it. */
export const openLogin = () => {
  if (state.login) void shell.openExternal(state.login)
}

/**
 * Starts the member's governed runtime. Without a stored session, or once RAD refuses it, the member signs in with
 * their corporate Google account in the system browser: Google refuses sign-in inside embedded browsers.
 */
export async function connect(command: readonly string[]): Promise<SidecarCredentials.Data> {
  if (state.child && state.ready) return state.ready
  const session = stored() ?? (await signIn())

  const ready = await start(command, session).catch((error: { status?: number }) => {
    if (error.status !== 401) throw error

    return undefined
  })

  if (ready) return ready
  getStore().delete(RAD_SESSION_KEY)

  return connect(command)
}

/** Copies pending work to RAD, closes the Framework console and forgets the session. */
export async function logout() {
  getStore().delete(RAD_SESSION_KEY)
  const child = state.child

  if (!child) return

  const done = new Promise<void>((resolve) => {
    child.once("exit", () => resolve())
    setTimeout(resolve, 20000).unref()
  })

  child.stdin.end(JSON.stringify({ type: "logout" }) + "\n")
  await done
}

// Without OS encryption the session is not kept; the member signs in on each launch.
function remember(session: typeof Session.Type) {
  if (!safeStorage.isEncryptionAvailable()) return
  getStore().set(RAD_SESSION_KEY, safeStorage.encryptString(JSON.stringify(session)).toString("base64"))
}

function stored() {
  if (!safeStorage.isEncryptionAvailable()) return

  // A profile copied from another machine or user cannot be decrypted; it means signing in again.
  return Option.getOrUndefined(
    Schema.decodeUnknownOption(Schema.String)(getStore().get(RAD_SESSION_KEY)).pipe(
      Option.flatMap(Option.liftThrowable((value: string) => safeStorage.decryptString(Buffer.from(value, "base64")))),
      Option.flatMap(Schema.decodeUnknownOption(Schema.fromJsonString(Session))),
    ),
  )
}

function signIn() {
  state.status = { ...state.status, stage: "signing-in" }
  const nonce = randomUUID()

  return new Promise<typeof Session.Type>((resolve) => {
    const server = createServer((req, res) => {
      res.setHeader("Cache-Control", "no-store")

      if (req.method === "GET" && req.url === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Referrer-Policy": "no-referrer" })
        res.end(radSignInPage({ firebase: JSON.parse(firebase ?? "{}"), mode: { type: "desktop", state: nonce } }))

        return
      }

      if (req.method !== "POST" || req.url !== "/login" || req.headers.origin !== state.login?.slice(0, -1)) {
        res.writeHead(404)
        res.end()

        return
      }

      void body(req)
        .then(async (input) => {
          if (input?.state !== nonce) return 401
          // RAD verifies the Google account and opens the session of the RAD member who owns it.
          const result = await radLogin(input.idToken)

          if ("status" in result) return result.status === 404 ? 403 : 401
          const session = result.session
          state.login = undefined
          server.close()
          resolve(session)

          return 200
        })
        .then((code) => {
          res.writeHead(code, { "Content-Type": "application/json" })
          res.end("{}")
        })
    })

    server.listen(0, "127.0.0.1", () => {
      // SAFETY: a server listening on a TCP port reports an AddressInfo, never a pipe name.
      state.login = `http://localhost:${(server.address() as AddressInfo).port}/`
      openLogin()
    })
  })
}

async function radLogin(idToken: string) {
  const response = await fetch(auth + "/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tokenId: idToken }),
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  }).catch(() => undefined)

  if (!response?.ok) return { status: response?.status ?? 503 }
  const login = Schema.decodeUnknownOption(LoginResponse)(await response.json())

  if (Option.isNone(login)) return { status: 503 }

  return { session: { token: login.value.data.tokens.accessToken, refreshToken: login.value.data.tokens.refreshToken } }
}

function start(command: readonly string[], session: typeof Session.Type) {
  state.status = { ...state.status, stage: "starting", expired: false }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    RAD_USAGE_API: api,
    RAD_API_URL: auth,
    RAD_CODE_DATA: path.join(app.getPath("userData"), "rad"),
  }

  if (framework) env.BAMBU_IA_ORIGIN = framework
  const child = spawn(command[0], [...command.slice(1), "rad"], { env, windowsHide: true })
  // The session goes over stdin so that tools started by the runtime never inherit it.
  child.stdin.write(JSON.stringify(session) + "\n")
  const errors: string[] = []
  createInterface({ input: child.stderr }).on("line", (line) => {
    errors.push(line)

    if (errors.length > 20) errors.shift()
  })

  return new Promise<SidecarCredentials.Data>((resolve, reject) => {
    createInterface({ input: child.stdout }).on("line", (line) => {
      const message = Option.getOrUndefined(Schema.decodeUnknownOption(Message)(line))

      if (message?.type === "ready" && message.url && message.password) {
        state.child = child
        state.ready = { url: message.url, password: message.password }
        state.status = { ...state.status, stage: "ready", user: message.user, framework: "connecting" }
        remember(session)
        resolve(state.ready)
      }

      // The runtime renewed an expired access token.
      if (message?.type === "session" && message.token && message.refreshToken)
        remember({ token: message.token, refreshToken: message.refreshToken })

      if (message?.type === "error") reject(Object.assign(Error("RAD sign-in failed"), { status: message.status }))

      if (message?.type === "status")
        state.status = { ...state.status, framework: message.framework, pending: message.pending ?? 0 }

      if (message?.type === "signedOut") state.status = { ...state.status, expired: true }
    })
    child.once("error", reject)
    child.once("exit", (code) => {
      if (state.child === child) {
        state.child = undefined
        state.ready = undefined
        state.status = { ...state.status, stage: "signed-out" }
      }

      reject(Error(`RAD runtime exited with ${code}: ${errors.slice(-5).join(" | ")}`))
    })
  })
}

async function body(req: IncomingMessage) {
  const chunks: Buffer[] = []

  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk))

    if (chunks.reduce((size, item) => size + item.length, 0) > 20000) return undefined
  }

  return Option.getOrUndefined(
    Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Struct({ state: Schema.String, idToken: Schema.String })))(
      Buffer.concat(chunks).toString(),
    ),
  )
}
