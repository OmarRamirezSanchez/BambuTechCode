import { createHash } from "node:crypto"
import { Database } from "bun:sqlite"

export type RadCall = <T>(path: string, body?: unknown) => Promise<T>
export type CoreCall = <T>(path: string) => Promise<T>
type Message = {
  id: string
  type: string
  text?: string
  content?: { type: string; text?: string }[]
  time: { created: number }
}

/** Durable pending work contains identifiers only; conversation text stays in the user's core database. */
export class RadSync {
  readonly journal: Database
  private running = false
  constructor(path: string) {
    this.journal = new Database(path, { create: true })
    this.journal.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS pending(id TEXT PRIMARY KEY, version INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS mcp(id TEXT PRIMARY KEY,session TEXT NOT NULL,name TEXT NOT NULL,tool TEXT NOT NULL,status TEXT NOT NULL)",
    )
    this.journal.exec(
      "CREATE TABLE IF NOT EXISTS sent(session TEXT NOT NULL,source TEXT NOT NULL,hash TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(session,source))",
    )
    const columns = this.journal.query<{ name: string }, []>("PRAGMA table_info(pending)").all()
    if (!columns.some((column) => column.name === "attempted"))
      this.journal.exec("ALTER TABLE pending ADD COLUMN attempted INTEGER NOT NULL DEFAULT 0")
  }
  mark(id: string) {
    this.journal
      .query("INSERT INTO pending(id,version) VALUES(?,1) ON CONFLICT(id) DO UPDATE SET version=version+1")
      .run(id)
  }
  tool(input: { id: string; sessionID: string; server: string; tool: string; status: string }) {
    this.journal
      .query("INSERT INTO mcp VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status")
      .run(input.id, input.sessionID, input.server, input.tool, input.status)
    this.mark(input.sessionID)
  }
  async flush(core: CoreCall, rad: RadCall) {
    if (this.running) return
    this.running = true
    try {
      let failure: unknown
      for (const pending of this.journal
        .query<{ id: string; version: number }, []>("SELECT id,version FROM pending ORDER BY attempted,id LIMIT 20")
        .all()) {
        this.journal.query("UPDATE pending SET attempted=? WHERE id=?").run(Date.now(), pending.id)
        try {
          const session = await core<{ data: { title: string } }>(`/api/session/${encodeURIComponent(pending.id)}`)
          const record = await rad<{ id: string }>("/sessions", {
            sourceId: pending.id,
            title: (session.data.title || "Sesión de trabajo").slice(0, 300),
          })
          let cursor: string | undefined
          do {
            const params = new URLSearchParams({ limit: "200", ...(cursor ? { cursor } : { order: "asc" }) })
            const page = await core<{ data: Message[]; cursor: { next?: string } }>(
              `/api/session/${encodeURIComponent(pending.id)}/message?${params}`,
            )
            for (const message of page.data) {
              if (message.type !== "user" && message.type !== "assistant") continue
              const content =
                message.type === "user"
                  ? (message.text ?? "")
                  : (message.content ?? [])
                      .filter((part) => part.type === "text")
                      .map((part) => part.text ?? "")
                      .join("\n")
              // Segment long messages losslessly; each segment retains the original role and timestamp.
              const previous = this.journal
                .query<
                  { source: string; hash: string; revision: number },
                  [string, string]
                >("SELECT source,hash,revision FROM sent WHERE session=? AND source LIKE ?")
                .all(pending.id, message.id + ":%")
              const chunks = Math.max(1, Math.ceil(content.length / 190000), previous.length)
              for (let index = 0; index < chunks; index++) {
                const sourceId = `${message.id}:${String(index).padStart(5, "0")}`,
                  text = content.slice(index * 190000, (index + 1) * 190000)
                const hash = createHash("sha256").update(text).digest("hex"),
                  saved = previous.find((row) => row.source === sourceId)
                if (saved?.hash === hash) continue
                const revision = (saved?.revision ?? 0) + 1
                await rad(`/sessions/${record.id}/messages`, {
                  sourceId,
                  role: message.type,
                  content: text,
                  occurredAt: new Date(message.time.created).toISOString(),
                  revision,
                })
                this.journal
                  .query(
                    "INSERT INTO sent VALUES(?,?,?,?) ON CONFLICT(session,source) DO UPDATE SET hash=excluded.hash,revision=excluded.revision",
                  )
                  .run(pending.id, sourceId, hash, revision)
              }
            }
            cursor = page.cursor.next
          } while (cursor)
          const events = this.journal
            .query<
              { id: string; name: string; tool: string; status: string },
              [string]
            >("SELECT id,name,tool,status FROM mcp WHERE session=?")
            .all(pending.id)
          for (const event of events) {
            const hex = createHash("sha256")
              .update(pending.id + ":" + event.id)
              .digest("hex")
            const eventId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
            await rad(`/sessions/${record.id}/mcp`, {
              eventId,
              name: event.name,
              tool: event.tool,
              status: event.status,
            })
            if (event.status !== "requested")
              this.journal.query("DELETE FROM mcp WHERE id=? AND status=?").run(event.id, event.status)
          }
          this.journal.query("DELETE FROM pending WHERE id=? AND version=?").run(pending.id, pending.version)
        } catch (error) {
          failure = error
        }
      }
      if (failure) throw failure
    } finally {
      this.running = false
    }
  }
  close() {
    this.journal.close()
  }
}
