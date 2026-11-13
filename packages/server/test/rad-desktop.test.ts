import { test, expect } from "bun:test"
import { createServer } from "node:http"
import { mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { radDesktop } from "../src/rad-desktop"

const listen = async (server: ReturnType<typeof createServer>) => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw Error("No address")
  return `http://127.0.0.1:${address.port}`
}

const read = async (req: AsyncIterable<Buffer | string>) => {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  return chunks.length ? (JSON.parse(Buffer.concat(chunks).toString()) as unknown) : undefined
}

// Starts a real governed runtime, like the gateway tests.
test("a desktop sign-in opens the member's governed runtime and closes its Framework console on logout", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rad-desktop-"))
  const calls = { logins: 0, exchange: [] as unknown[], logout: [] as unknown[] }
  const rad = createServer(async (req, res) => {
    await read(req)
    res.setHeader("Content-Type", "application/json")
    // RAD renews an expired access token only with the member's refresh token.
    if (req.url === "/auth/refresh") {
      if (req.headers.authorization !== "Bearer refresh-a") res.writeHead(401)
      res.end(JSON.stringify({ data: { accessToken: "user-a" } }))
      return
    }
    if (req.headers.authorization !== "Bearer user-a") {
      res.writeHead(401)
      res.end("{}")
      return
    }
    if (req.url === "/logins") calls.logins++
    res.end(JSON.stringify({ data: req.url === "/me" ? { id: 7, name: "Ana", email: "ana@example.test" } : {} }))
  })
  const framework = createServer(async (req, res) => {
    const input = await read(req)
    res.setHeader("Content-Type", "application/json")
    if (req.url === "/auth/exchange" && req.headers.authorization === "Bearer user-a") {
      calls.exchange.push(input)
      res.end(
        JSON.stringify({
          data: {
            token: "console-1",
            expiresAt: "2099-01-01T00:00:00.000Z",
            refreshToken: "refresh-1",
            refreshExpiresAt: "2099-01-01T00:00:00.000Z",
            consoleId: "6f1d1f43-2b52-4a43-9d3e-0f3f1e4f5a10",
            user: { id: 7, name: "Ana", email: "ana@example.test" },
          },
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
  const api = await listen(rad)
  const previous = process.env.BAMBU_IA_ORIGIN
  process.env.BAMBU_IA_ORIGIN = await listen(framework)
  try {
    await expect(
      radDesktop({ api, data: directory, session: { token: "revoked", refreshToken: "revoked" } }),
    ).rejects.toMatchObject({ status: 401 })

    // An expired access token is renewed, and the desktop learns the new session to keep it.
    const renewed: unknown[] = []
    const session = await radDesktop({
      api,
      data: directory,
      session: { token: "expired", refreshToken: "refresh-a" },
      onSession: (value) => renewed.push(value),
    })
    expect(renewed).toEqual([{ token: "user-a", refreshToken: "refresh-a" }])
    expect(session.user).toEqual({ id: 7, name: "Ana", email: "ana@example.test" })
    expect(calls.logins).toBe(1)
    const core = (endpoint: string) =>
      fetch(session.url + endpoint, {
        headers: { Authorization: "Basic " + Buffer.from("opencode:" + session.password).toString("base64") },
      })
    expect((await fetch(session.url + "/api/credential")).status).toBe(401)

    await session.tick()
    expect(session.status()).toEqual({ framework: "connected", pending: 0 })
    const credentials = (await (await core("/api/credential")).json()).data
    expect(credentials).toMatchObject([{ integrationID: "bambu-ia", value: { access: "console-1", refresh: "refresh-1" } }])
    // The runtime only holds the Framework console; the RAD token stays with the desktop.
    expect(JSON.stringify(credentials)).not.toContain("user-a")
    expect(calls.exchange).toEqual([{ consoleName: "BambuTechCode" }])

    await session.logout()
    expect(calls.logout).toEqual([{ refreshToken: "refresh-1" }])
    expect((await (await core("/api/credential")).json()).data).toEqual([])
    await session.close()
  } finally {
    if (previous === undefined) delete process.env.BAMBU_IA_ORIGIN
    else process.env.BAMBU_IA_ORIGIN = previous
    await new Promise<void>((resolve) => rad.close(() => resolve()))
    await new Promise<void>((resolve) => framework.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  }
}, 30000)
