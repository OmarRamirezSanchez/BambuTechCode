import { test, expect } from "bun:test"
import { createServer } from "node:http"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { createRadGateway } from "../src/rad-gateway"

test("requires RAD identity for APIs and isolates real core histories across accounts", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rad-gateway-"))
  const assets = path.join(directory, "assets")
  await mkdir(assets)
  await writeFile(path.join(assets, "index.html"), "authenticated app")
  const upstream = createServer((req, res) => {
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
      token,
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
