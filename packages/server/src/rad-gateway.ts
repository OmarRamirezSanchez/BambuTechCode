import { createServer, request, type IncomingMessage, type ServerResponse } from "node:http"
import { createHash, randomUUID } from "node:crypto"
import { connect } from "node:net"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { BambuIA } from "@opencode/core/plugin/provider/bambu-ia"
import { frameworkLink } from "./rad-framework"
import { radAuthApi, radLogin, radRefresh } from "./rad-login"
import { radRuntime } from "./rad-runtime"
import { radCall } from "./rad-sync"

type Identity = { id: number; name: string; email: string }
type Account = { token: string; refreshToken: string; user: Identity }
/** The public web config of RAD's Firebase project, which owns its Google sign-in. */
export type FirebaseConfig = { apiKey: string; authDomain: string; projectId: string }
type Runtime = Awaited<ReturnType<typeof radRuntime>> & {
  account: Account
  framework: ReturnType<typeof frameworkLink>
}
export interface RadGatewayConfig {
  origin: string
  radOrigin: string
  api: string
  data: string
  assets: string
  firebase: FirebaseConfig
  vite?: string
}

export function createRadGateway(config: RadGatewayConfig) {
  const origin = new URL(config.origin).origin
  const radOrigin = new URL(config.radOrigin).origin
  if (!/^https:/.test(config.api) && !["localhost", "127.0.0.1"].includes(new URL(config.api).hostname))
    throw Error("RAD API requires HTTPS")
  const sessions = new Map<string, Account>()
  const challenges = new Map<string, number>()
  const runtimes = new Map<number, Promise<Runtime>>()
  const sockets = new Map<string, Set<{ destroy: () => void }>>()
  const cookie = (req: IncomingMessage, name: string) =>
    req.headers.cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(name + "="))
      ?.slice(name.length + 1)
  const cookieHeader = (name: string, value: string, age: number) =>
    `${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${origin.startsWith("https:") ? "; Secure" : ""}`
  const authApi = radAuthApi(config.api)
  const call = (account: Pick<Account, "token">) => radCall(config.api, account.token)
  // An expired access token is renewed once with the member's refresh token before the session ends.
  const identify = (value: Account) =>
    call(value)<Identity>("/me").catch(async (error: { status?: number }) => {
      if (error.status !== 401) throw error
      value.token = (await radRefresh(authApi, value)).token
      return call(value)<Identity>("/me")
    })
  const account = async (req: IncomingMessage) => {
    const key = cookie(req, "rad_code") ?? "",
      value = sessions.get(key)
    if (!value) return undefined
    const user = await identify(value).catch(() => undefined)
    if (!user) {
      sessions.delete(key)
      for (const socket of sockets.get(key) ?? []) socket.destroy()
      sockets.delete(key)
      return undefined
    }
    return { key, value: { ...value, user } }
  }
  // With BambuIAFrameWork every model call goes through it; the runtime's core plugin reads the same origin.
  const framework = BambuIA.origin()
  const open = (value: Account) => {
    const existing = runtimes.get(value.user.id)
    if (existing)
      return existing.then((item) => {
        item.account = value
        return item
      })
    // An environment change gets a separate history, even when user ids overlap.
    const issuer = createHash("sha256").update(config.api).digest("hex").slice(0, 16)
    const pending = radRuntime(path.join(config.data, issuer, String(value.user.id)), { governed: Boolean(framework) })
      .then((item): Runtime => ({ ...item, account: value, framework: frameworkLink(item.request) }))
      .catch((error) => {
        runtimes.delete(value.user.id)
        throw error
      })
    runtimes.set(value.user.id, pending)
    return pending
  }
  const runtime = async (value: Account) => {
    const app = await open(value)
    await app.framework.sync(app.account.token)
    return app
  }
  const json = (res: ServerResponse, status: number, value: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" })
    res.end(JSON.stringify(value))
  }
  const body = async (req: IncomingMessage) => {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > 20000) throw Error("Payload too large")
      chunks.push(Buffer.from(chunk))
    }
    return JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>
  }
  const proxy = (req: IncomingMessage, res: ServerResponse, target: string, authorization?: string) => {
    const headers = Object.fromEntries(
      Object.entries({
        ...req.headers,
        host: new URL(target).host,
        cookie: undefined,
        authorization,
        origin: undefined,
      }).filter(([, value]) => value !== undefined),
    )
    const upstream = request(new URL(req.url ?? "/", target), { method: req.method, headers }, (response) => {
      res.writeHead(response.statusCode ?? 502, { ...response.headers, "cache-control": "no-store" })
      response.pipe(res)
    })
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502)
      res.end()
    })
    res.on("close", () => upstream.destroy())
    req.pipe(upstream)
  }
  const server = createServer((req, res) => {
    void (async () => {
      res.setHeader("Cache-Control", "no-store")
      res.setHeader("Referrer-Policy", "no-referrer")
      res.setHeader("X-Content-Type-Options", "nosniff")
      if (req.headers.host !== new URL(origin).host) {
        res.writeHead(403)
        res.end()
        return
      }
      if (req.headers.origin && req.headers.origin !== origin) {
        res.writeHead(403)
        res.end()
        return
      }
      const url = new URL(req.url ?? "/", origin),
        prefix = "/api/experimental/rad"
      if (url.origin !== origin) {
        json(res, 403, { error: "INVALID_TARGET" })
        return
      }
      req.url = url.pathname + url.search
      // Pairing would issue a core credential that bypasses RAD session revocation.
      if (url.pathname === "/api/pair" || url.pathname.startsWith("/auth/connect/")) {
        json(res, 403, { error: "RAD_LOGIN_REQUIRED" })
        return
      }
      if (req.method !== "GET" && req.method !== "HEAD" && req.headers.origin !== origin) {
        json(res, 403, { error: "ORIGIN_REQUIRED" })
        return
      }
      if (url.pathname === prefix + "/request" && req.method === "POST") {
        for (const [key, expires] of challenges) if (expires < Date.now()) challenges.delete(key)
        if (challenges.size >= 100) {
          json(res, 429, { error: "TRY_AGAIN" })
          return
        }
        const state = randomUUID()
        challenges.set(state, Date.now() + 300000)
        res.setHeader("Set-Cookie", cookieHeader("rad_challenge", state, 300))
        json(res, 200, { state })
        return
      }
      if (url.pathname === prefix + "/login" && req.method === "POST") {
        const input = await body(req),
          challenge = cookie(req, "rad_challenge") ?? ""
        if (
          input.state !== challenge ||
          (challenges.get(challenge) ?? 0) < Date.now() ||
          typeof input.idToken !== "string"
        ) {
          json(res, 401, { error: "LOGIN_REQUIRED" })
          return
        }
        challenges.delete(challenge)
        // The member signs in with their corporate Google account; RAD turns it into their RAD session.
        const session = await radLogin(authApi, input.idToken).catch((error: { status?: number }) => ({
          status: error.status ?? 503,
        }))
        if ("status" in session) {
          // RAD answers 404 for a Google account without a RAD member.
          if (session.status === 404) json(res, 403, { error: "NOT_A_MEMBER" })
          else json(res, 401, { error: "LOGIN_REQUIRED" })
          return
        }
        const value: Account = { ...session, user: await call(session)<Identity>("/me") }
        await call(value)("/logins", { id: randomUUID() })
        const key = randomUUID() + randomUUID()
        sessions.set(key, value)
        res.setHeader("Set-Cookie", [cookieHeader("rad_code", key, 28800), cookieHeader("rad_challenge", "", 0)])
        res.setHeader("Clear-Site-Data", '"cache", "storage"')
        json(res, 200, { user: value.user })
        return
      }
      if (url.pathname === prefix + "/logout" && req.method === "POST") {
        const key = cookie(req, "rad_code") ?? "",
          ended = sessions.get(key)
        sessions.delete(key)
        for (const socket of sockets.get(key) ?? []) socket.destroy()
        sockets.delete(key)
        // Signing out of the last RAD session closes the member's Framework console.
        if (ended && !Array.from(sessions.values()).some((item) => item.user.id === ended.user.id))
          await runtimes.get(ended.user.id)?.then((app) => app.framework.unlink())
        res.setHeader("Set-Cookie", cookieHeader("rad_code", "", 0))
        res.setHeader("Clear-Site-Data", '"cache", "storage"')
        json(res, 200, { loggedOut: true })
        return
      }
      const auth = await account(req)
      if (!auth) {
        if (url.pathname.startsWith("/api/")) {
          json(res, 401, { error: "LOGIN_REQUIRED" })
          return
        }
        res.setHeader("Content-Type", "text/html; charset=utf-8")
        res.end(loginPage(config.firebase))
        return
      }
      if (url.pathname === prefix + "/me") {
        const active = runtimes.get(auth.value.user.id),
          app = active ? await active : undefined
        const pending =
          app?.journal.journal.query<{ count: number }, []>("SELECT count(*) count FROM pending").get()?.count ?? 0
        // The runtime opens on the first API request; until then the Framework is still connecting.
        const status = app ? app.framework.status(auth.value.token) : framework ? "connecting" : "disabled"
        json(res, 200, { user: auth.value.user, radOrigin, pending, framework: status })
        return
      }
      if (url.pathname.startsWith("/api/")) {
        const app = await runtime(auth.value)
        const active = sockets.get(auth.key) ?? new Set()
        active.add(res)
        sockets.set(auth.key, active)
        res.on("close", () => active.delete(res))
        // Preserve unsynchronized transcripts until RAD has acknowledged their messages.
        if (req.method === "DELETE" && /^\/api\/session\/[^/]+$/.test(url.pathname)) {
          app.journal.mark(decodeURIComponent(url.pathname.split("/")[3]))
          await app.journal.flush(app.core, call(app.account))
          if (
            app.journal.journal
              .query("SELECT id FROM pending WHERE id=?")
              .get(decodeURIComponent(url.pathname.split("/")[3]))
          ) {
            json(res, 409, { error: "SYNC_PENDING" })
            return
          }
        }
        proxy(req, res, app.origin, app.authorization)
        return
      }
      if (config.vite) {
        proxy(req, res, config.vite)
        return
      }
      const file = path.resolve(config.assets, "." + decodeURIComponent(url.pathname))
      if (!file.startsWith(path.resolve(config.assets) + path.sep)) {
        res.writeHead(404)
        res.end()
        return
      }
      const exists = await stat(file)
        .then((info) => info.isFile())
        .catch(() => false)
      const target = exists ? file : path.join(config.assets, "index.html")
      const types: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".woff2": "font/woff2",
        ".json": "application/json",
      }
      res.setHeader("Content-Type", types[path.extname(target)] ?? "application/octet-stream")
      res.end(await readFile(target))
    })().catch(() => {
      if (!res.headersSent) json(res, 503, { error: "RAD_UNAVAILABLE" })
      else res.end()
    })
  })
  server.on("upgrade", (req, socket, head) => {
    void (async () => {
      if (req.headers.host !== new URL(origin).host || req.headers.origin !== origin) {
        socket.destroy()
        return
      }
      const auth = await account(req)
      if (!auth) {
        socket.destroy()
        return
      }
      const app = await runtime(auth.value),
        isApi = (req.url ?? "").startsWith("/api/")
      const target = new URL(isApi ? app.origin : (config.vite ?? app.origin))
      const upstream = connect(Number(target.port), target.hostname, () => {
        const headers = {
          ...req.headers,
          host: target.host,
          cookie: undefined,
          origin: undefined,
          authorization: isApi ? app.authorization : undefined,
        }
        upstream.write(
          `${req.method} ${req.url} HTTP/1.1\r\n` +
            Object.entries(headers)
              .filter(([, value]) => value !== undefined)
              .map(([key, value]) => `${key}: ${value}`)
              .join("\r\n") +
            "\r\n\r\n",
        )
        if (head.length) upstream.write(head)
        socket.pipe(upstream).pipe(socket)
      })
      const active = sockets.get(auth.key) ?? new Set()
      active.add(socket)
      sockets.set(auth.key, active)
      socket.on("close", () => {
        active.delete(socket)
        upstream.destroy()
      })
      upstream.on("error", () => socket.destroy())
      socket.on("error", () => upstream.destroy())
    })().catch(() => socket.destroy())
  })
  const timer = setInterval(() => {
    for (const entry of runtimes.values())
      void entry
        .then((app) => app.journal.flush(app.core, call(app.account)))
        .catch(() => {
          /* Pending identifiers stay in the journal for the next attempt. */
        })
  }, 5000)
  timer.unref()
  return {
    server,
    close: async () => {
      clearInterval(timer)
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      for (const entry of runtimes.values()) await (await entry).close()
    },
  }
}

// Signs the member in with RAD's Firebase project, the corporate Google sign-in RAD itself uses, and gives the Google
// ID token to the gateway, which exchanges it with RAD for the member's session.
function loginPage(firebase: FirebaseConfig) {
  const encoded = JSON.stringify(firebase).replace(/</g, "\\u003c")
  return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BambuTechCode · RAD</title><style>body{margin:0;background:#102b22;color:#edf7ee;font-family:inherit;min-height:100vh;display:grid;place-items:center}main{max-width:520px;margin:30px;padding:40px;border:1px solid #557a62;border-radius:20px;background:#18382b}small{letter-spacing:.15em;color:#b0d98c}h1{font-size:38px;line-height:1.2}p{line-height:1.7;color:#c1d7cb}button{padding:14px 22px;border:0;border-radius:8px;background:#b3e58d;color:#18382b;font:inherit;cursor:pointer}#status{min-height:24px}</style><main><small>BAMBU TECHSERVICES</small><h1>Tu espacio de trabajo, conectado a RAD.</h1><p>Inicia sesión con tu cuenta corporativa de Google para continuar en BambuTechCode. Tus conversaciones, sesiones y uso de MCP estarán disponibles en Gobernanza según tus permisos.</p><button id="login">Continuar con Google</button><p id="status" role="status"></p></main><script type="module">
  import{initializeApp}from"https://www.gstatic.com/firebasejs/10.11.1/firebase-app.js";
  import{getAuth,GoogleAuthProvider,signInWithPopup,signOut}from"https://www.gstatic.com/firebasejs/10.11.1/firebase-auth.js";
  const auth=getAuth(initializeApp(${encoded})),button=document.getElementById('login'),status=document.getElementById('status');
  button.onclick=async()=>{button.disabled=true;status.textContent='Continúa en la ventana de Google.';try{const provider=new GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});const idToken=await(await signInWithPopup(auth,provider)).user.getIdToken();await signOut(auth);const challenge=await fetch('/api/experimental/rad/request',{method:'POST'});if(!challenge.ok)throw Error();const{state}=await challenge.json();const response=await fetch('/api/experimental/rad/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state,idToken})});if(response.status===403){status.textContent='Tu cuenta de Google no está registrada en RAD. Usa tu cuenta corporativa.';button.disabled=false;return}if(!response.ok)throw Error();location.replace('/')}catch(error){status.textContent=error?.code==='auth/popup-blocked'?'Permite las ventanas emergentes para iniciar sesión.':'No se pudo iniciar sesión. Intenta nuevamente.';button.disabled=false}};
  </script></html>`
}
