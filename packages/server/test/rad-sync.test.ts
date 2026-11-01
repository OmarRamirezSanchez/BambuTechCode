import { test, expect } from "bun:test"
import { RadSync, type CoreCall, type RadCall } from "../src/rad-sync"

test("keeps pending work across API failures and synchronizes user/assistant text without reasoning", async () => {
  const sync = new RadSync(":memory:")
  const sent: { path: string; body: unknown }[] = []
  const core: CoreCall = async <T>(path: string) =>
    (path.includes("/message")
      ? {
          data: [
            { id: "msg_a", type: "user", text: "Implementa el API", time: { created: 1000 } },
            {
              id: "msg_b",
              type: "assistant",
              content: [
                { type: "reasoning", text: "private internal reasoning" },
                { type: "text", text: "Implementación terminada" },
              ],
              time: { created: 2000 },
            },
          ],
          cursor: {},
        }
      : { data: { title: "Trabajo" } }) as T
  const rad: RadCall = async <T>(path: string, body?: unknown) => {
    sent.push({ path, body })
    return { id: "00000000-0000-4000-8000-000000000001" } as T
  }
  sync.mark("ses_test")
  await expect(
    sync.flush(core, async () => {
      throw Error("disconnected")
    }),
  ).rejects.toThrow("disconnected")
  expect(sync.journal.query("SELECT id FROM pending").all()).toHaveLength(1)
  await sync.flush(core, rad)
  expect(sync.journal.query("SELECT id FROM pending").all()).toHaveLength(0)
  expect(
    sent.filter((item) => item.path.endsWith("/messages")).map((item) => (item.body as { content: string }).content),
  ).toEqual(["Implementa el API", "Implementación terminada"])
  sync.close()
})

test("does not drop newer events that arrive during synchronization and records actual MCP names", async () => {
  const sync = new RadSync(":memory:")
  const events: unknown[] = []
  sync.tool({
    id: "tool-1",
    sessionID: "ses_test",
    server: "RAD Proyectos",
    tool: "search_project_context",
    status: "succeeded",
  })
  const core: CoreCall = async <T>(path: string) => {
    if (path.includes("/message")) {
      sync.mark("ses_test")
      return { data: [], cursor: {} } as T
    }
    return { data: { title: "Trabajo" } } as T
  }
  const rad: RadCall = async <T>(path: string, body?: unknown) => {
    if (path.endsWith("/mcp")) events.push(body)
    return { id: "00000000-0000-4000-8000-000000000001" } as T
  }
  await sync.flush(core, rad)
  expect(sync.journal.query("SELECT id FROM pending").all()).toHaveLength(1)
  expect(events).toHaveLength(1)
  expect(events[0]).toMatchObject({ name: "RAD Proyectos", tool: "search_project_context", status: "succeeded" })
  sync.close()
})
