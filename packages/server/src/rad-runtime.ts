import { Effect, Exit, Scope } from "effect"
import { Global } from "@opencode/util/global"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { ServerProcess } from "./process"
import { RadSync } from "./rad-sync"

export async function radRuntime(directory: string) {
  await mkdir(directory, { recursive: true })
  const journal = new RadSync(path.join(directory, "governance.sqlite"))
  const scope = Scope.makeUnsafe()
  const password = randomUUID() + randomUUID()
  const runtime = await Effect.runPromise(
    ServerProcess.start<never, never>(
      {
        hostname: "127.0.0.1",
        port: 0,
        password,
        database: { path: path.join(directory, "conversations.sqlite") },
        config: { directory: path.join(directory, "config") },
      },
      undefined,
      undefined,
      undefined,
      {
        overrides: [
          Global.node.replace(
            Global.layerWith({
              data: directory,
              config: path.join(directory, "config"),
              state: path.join(directory, "state"),
              cache: path.join(directory, "cache"),
              log: path.join(directory, "log"),
              tmp: path.join(directory, "tmp"),
            }),
          ),
        ],
        observe: (event) =>
          Effect.sync(() => {
            const data = event.data as Record<string, unknown>
            if (typeof data.sessionID !== "string") return
            if (event.type === "mcp.tool.used")
              journal.tool(data as { id: string; sessionID: string; server: string; tool: string; status: string })
            else if (
              event.type.startsWith("session.") &&
              event.type !== "session.deleted" &&
              !event.type.endsWith("streamed") &&
              !event.type.endsWith("delta")
            )
              journal.mark(data.sessionID)
          }),
      },
    ).pipe(Effect.provideService(Scope.Scope, scope)),
  )
  const address = runtime.address
  if (address._tag === "UnixPathAddress") throw Error("TCP runtime required")
  const origin = `http://127.0.0.1:${address.port}`
  const authorization = "Basic " + Buffer.from("opencode:" + password).toString("base64")
  const core = async <T>(endpoint: string): Promise<T> => {
    const response = await fetch(origin + endpoint, {
      headers: { Authorization: authorization },
      signal: AbortSignal.timeout(30000),
    })
    if (!response.ok) throw Error("Code runtime unavailable")
    return response.json() as Promise<T>
  }
  return {
    origin,
    authorization,
    journal,
    core,
    close: async () => {
      await Effect.runPromise(Scope.close(scope, Exit.void))
      journal.close()
    },
  }
}
