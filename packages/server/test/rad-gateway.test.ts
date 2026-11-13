import { test, expect } from "bun:test"
import { createServer, type ServerResponse } from "node:http"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { createRadGateway } from "../src/rad-gateway"

const firebase = { apiKey: "test-key", authDomain: "rad.example.test", projectId: "rad" }

// RAD's Google sign-in: a Firebase ID token for a member becomes their RAD session; other accounts are not members.
async function googleLogin(req: AsyncIterable<Buffer | string>, res: ServerResponse) {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  const tokenId = (JSON.parse(Buffer.concat(chunks).toString()) as { tokenId: string }).tokenId
  res.setHeader("Content-Type", "application/json")
  if (!/^google-[ab]$/.test(tokenId)) {
    res.writeHead(404)
    res.end("{}")
    return
  }
  const token = tokenId.replace("google-", "user-")
  res.end(JSON.stringify({ data: { tokens: { accessToken: token, refreshToken: "refresh-" + token } } }))
}

test("requires RAD identity for APIs and isolates real core histories across accounts", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rad-gateway-"))
  const assets = path.join(directory, "assets")
  await mkdir(assets)
  await writeFile(path.join(assets, "index.html"), "authenticated app")
  const upstream = createServer((req, res) => {
    if (req.url === "/auth/login") return googleLogin(req, res)
    const id = req.headers.authorization === "Bearer user-a" ? 1 : req.headers.authorization === "Bearer user-b" ? 2 : 0
    res.setHeader("Content-Type", "application/json")
    if (!id) {
      res.writeHead(401)
      res.end("{}")
      return
    }
    res.end(
      JSON.stringify({
        data:
          req.url === "/me"
            ? { id, name: `Test ${id}`, email: `${id}@example.test` }
            : { id: "recorded", recorded: true },
      }),
    )
  })
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve))
  const address = upstream.address()
  if (!address || typeof address === "string") throw Error("No upstream")
  const origin = "http://localhost",
    gateway = createRadGateway({
      origin,
      radOrigin: "http://localhost:4318",
      api: `http://127.0.0.1:${address.port}`,
      data: path.join(directory, "users"),
      assets,
      firebase,
    })
  await new Promise<void>((resolve) => gateway.server.listen(0, "127.0.0.1", resolve))
  const bound = gateway.server.address()
  if (!bound || typeof bound === "string") throw Error("No gateway")
  const call = (endpoint: string, method = "GET", cookie = "", body?: unknown) =>
    fetch(`http://127.0.0.1:${bound.port}` + endpoint, {
      method,
      headers: { host: "localhost", origin, cookie, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const login = async (token: string) => {
    const challenge = await call("/api/experimental/rad/request", "POST")
    const data = await challenge.json()
    const response = await call("/api/experimental/rad/login", "POST", `rad_challenge=${data.state}`, {
      state: data.state,
      idToken: token.replace("user-", "google-"),
    })
    expect(response.status).toBe(200)
    expect(response.headers.get("Set-Cookie")).toContain("HttpOnly")
    return response.headers
      .getSetCookie()
      .find((value) => value.startsWith("rad_code="))!
      .split(";")[0]
  }
  try {
    expect((await call("/api/session")).status).toBe(401)
    // A Google account without a RAD member cannot open a session.
    const outsider = (await (await call("/api/experimental/rad/request", "POST")).json()).state
    const refused = await call("/api/experimental/rad/login", "POST", `rad_challenge=${outsider}`, {
      state: outsider,
      idToken: "google-x",
    })
    expect(refused.status).toBe(403)
    expect(await refused.json()).toEqual({ error: "NOT_A_MEMBER" })
    const cookieA = await login("user-a")
    const created = await call("/api/session", "POST", cookieA, { title: "Only user A", location: { directory } })
    expect(created.status).toBe(200)
    const session = (await created.json()).data
    const cookieB = await login("user-b")
    expect((await call("/api/session/" + session.id, "GET", cookieB)).status).toBe(404)
    expect((await call("/api/session/" + session.id, "GET", cookieA)).status).toBe(200)
    expect((await call("/api/session/" + session.id, "DELETE", cookieA)).status).toBe(204)
    expect((await (await call("/api/experimental/rad/me", "GET", cookieA)).json()).pending).toBe(0)
    await call("/api/experimental/rad/logout", "POST", cookieA)
    expect((await call("/api/session", "GET", cookieA)).status).toBe(401)
  } finally {
    await gateway.close()
    await new Promise<void>((resolve) => upstream.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  }
}, 30000)

test("connects each RAD sign-in to BambuIAFrameWork and closes its console on sign-out", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rad-gateway-ia-"))
  const assets = path.join(directory, "assets")
  await mkdir(assets)
  await writeFile(path.join(assets, "index.html"), "authenticated app")
  const listen = async (server: ReturnType<typeof createServer>) => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw Error("No address")
    return `http://127.0.0.1:${address.port}`
  }
  const rad = createServer((req, res) => {
    if (req.url === "/auth/login") return googleLogin(req, res)
    res.setHeader("Content-Type", "application/json")
    if (req.headers.authorization !== "Bearer user-a") {
      res.writeHead(401)
      res.end("{}")
      return
    }
    res.end(JSON.stringify({ data: req.url === "/me" ? { id: 1, name: "Test 1", email: "1@example.test" } : {} }))
  })
  const calls = { exchange: [] as unknown[], config: [] as (string | undefined)[], logout: [] as unknown[] }
  const framework = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const input = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined
    res.setHeader("Content-Type", "application/json")
    if (req.url === "/auth/exchange" && req.headers.authorization === "Bearer user-a") {
      calls.exchange.push(input)
      res.end(
        JSON.stringify({
          data: {
            token: `console-${calls.exchange.length}`,
            expiresAt: "2099-01-01T00:00:00.000Z",
            refreshToken: `refresh-${calls.exchange.length}`,
            refreshExpiresAt: "2099-01-01T00:00:00.000Z",
            consoleId: "6f1d1f43-2b52-4a43-9d3e-0f3f1e4f5a10",
            user: { id: 1, name: "Test 1", email: "1@example.test" },
          },
        }),
      )
      return
    }
    if (req.url === "/v1/config") {
      calls.config.push(req.headers.authorization)
      res.end(
        JSON.stringify({
          providers: {
            "bambu-ia": {
              name: "BambuIAFrameWork",
              canonical: "amazon-bedrock",
              package: "@opencode/ai/providers/amazon-bedrock",
              settings: { baseURL: `${frameworkOrigin}/v1/bedrock`, region: "us-east-1", auth: "bearer" },
              models: { sonnet: { name: "Claude Sonnet 5.5", modelID: "us.anthropic.claude-sonnet-5-5-v1:0" } },
            },
          },
          policies: [
            { action: "provider.use", resource: "*", effect: "deny" },
            { action: "provider.use", resource: "bambu-ia", effect: "allow" },
          ],
        }),
      )
      return
    }
    if (req.url === "/auth/logout") {
      calls.logout.push(input)
      res.end(JSON.stringify({ data: { loggedOut: true } }))
      return
    }
    res.writeHead(401)
    res.end("{}")
  })
  const radOrigin = await listen(rad)
  const frameworkOrigin = await listen(framework)
  const previous = process.env.BAMBU_IA_ORIGIN
  process.env.BAMBU_IA_ORIGIN = frameworkOrigin
  const origin = "http://localhost",
    gateway = createRadGateway({
      origin,
      radOrigin: "http://localhost:4318",
      api: radOrigin,
      data: path.join(directory, "users"),
      assets,
      firebase,
    })
  const bound = await listen(gateway.server)
  const call = (endpoint: string, method = "GET", cookie = "", body?: unknown) =>
    fetch(bound + endpoint, {
      method,
      headers: { host: "localhost", origin, cookie, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const login = async () => {
    const challenge = await (await call("/api/experimental/rad/request", "POST")).json()
    const response = await call("/api/experimental/rad/login", "POST", `rad_challenge=${challenge.state}`, {
      state: challenge.state,
      idToken: "google-a",
    })
    return response.headers
      .getSetCookie()
      .find((value) => value.startsWith("rad_code="))!
      .split(";")[0]
  }
  try {
    const cookie = await login()
    const credentials = (await (await call("/api/credential", "GET", cookie)).json()).data
    expect(credentials).toMatchObject([
      {
        integrationID: "bambu-ia",
        label: "1@example.test",
        active: true,
        value: { type: "oauth", methodID: "rad", access: "console-1", refresh: "refresh-1" },
      },
    ])
    // The RAD token stays in the gateway; the runtime only holds the Framework console.
    expect(JSON.stringify(credentials)).not.toContain("user-a")
    expect(calls.exchange).toEqual([{ consoleName: "BambuTechCode" }])
    expect((await (await call("/api/experimental/rad/me", "GET", cookie)).json()).framework).toBe("connected")

    // The governed runtime offers only the Framework's provider once its config arrives.
    const deadline = Date.now() + 15000
    const available = async (): Promise<string[]> => {
      const body = (await (await call("/api/provider", "GET", cookie)).json()) as { data: { id: string }[] }
      const ids = body.data.map((provider) => provider.id)
      if (ids.includes("bambu-ia") || Date.now() > deadline) return ids
      await Bun.sleep(50)
      return available()
    }
    expect(await available()).toEqual(["bambu-ia"])
    expect(calls.config).toContain("Bearer console-1")
    expect(calls.exchange).toHaveLength(1)

    await call("/api/experimental/rad/logout", "POST", cookie)
    expect(calls.logout).toEqual([{ refreshToken: "refresh-1" }])

    // A new sign-in opens a new console instead of reusing the closed one.
    const again = await login()
    const replaced = (await (await call("/api/credential", "GET", again)).json()).data
    expect(replaced).toMatchObject([{ integrationID: "bambu-ia", value: { access: "console-2" } }])
    expect(calls.exchange).toEqual([{ consoleName: "BambuTechCode" }, { consoleName: "BambuTechCode" }])
  } finally {
    if (previous === undefined) delete process.env.BAMBU_IA_ORIGIN
    else process.env.BAMBU_IA_ORIGIN = previous
    await gateway.close()
    await new Promise<void>((resolve) => rad.close(() => resolve()))
    await new Promise<void>((resolve) => framework.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  }
}, 30000)
