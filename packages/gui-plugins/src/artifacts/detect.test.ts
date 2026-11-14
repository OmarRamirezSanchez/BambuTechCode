import { describe, expect, test } from "bun:test"
import type { SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client/promise"
import { sessionArtifacts } from "./detect"

type Call = {
  name: string
  status?: "completed" | "error" | "running"
  input?: Record<string, string>
  files?: { file: string; status: "added" | "deleted" | "modified" }[]
}

const tool = (call: Call, index: number): SessionMessageAssistantTool => {
  const base = {
    type: "tool" as const,
    id: `tool_${index}`,
    name: call.name,
    time: { created: index, completed: index },
  }

  const input = call.input ?? {}

  const metadata = call.files
    ? { files: call.files.map((file) => ({ ...file, patch: "", additions: 1, deletions: 0 })) }
    : undefined

  if (call.status === "error")
    return { ...base, state: { status: "error", input, error: { type: "tool", message: "failed" }, metadata } }

  if (call.status === "running") return { ...base, state: { status: "running", input, metadata: metadata ?? {} } }

  return { ...base, state: { status: "completed", input, content: [{ type: "text", text: "ok" }], metadata } }
}

const session = (calls: Call[]): SessionMessageInfo[] => [
  {
    type: "assistant",
    id: "msg_1",
    agent: "build",
    model: { id: "model", providerID: "provider" },
    content: calls.map(tool),
    time: { created: 0 },
  },
]

// The file model keys workspace files by their relative path, whether a tool named them absolutely or not.
const resolve = (path: string) => path.replace(/^\/repo\//, "")

describe("sessionArtifacts", () => {
  test.each<[string, Call[], [string, string][]]>([
    [
      "lists written pages, diagrams and media, newest first, and skips other files",
      [
        { name: "write", input: { path: "/repo/report.html" } },
        { name: "write", input: { path: "src/app.ts" } },
        { name: "write", input: { path: "docs/notes.md" } },
        { name: "write", input: { path: "chart.svg" } },
        { name: "write", input: { path: "flow.mmd" } },
        { name: "write", input: { path: "/tmp/out/photo.png" } },
        { name: "write", input: { path: "spec.pdf" } },
      ],
      [
        ["spec.pdf", "pdf"],
        ["/tmp/out/photo.png", "image"],
        ["flow.mmd", "mermaid"],
        ["chart.svg", "svg"],
        ["docs/notes.md", "markdown"],
        ["report.html", "html"],
      ],
    ],
    [
      "ignores calls that failed or have not finished",
      [
        { name: "write", status: "error", input: { path: "failed.html" } },
        { name: "write", status: "running", input: { path: "pending.html" } },
        { name: "read", input: { path: "read.html" } },
      ],
      [],
    ],
    [
      "keys one file named two ways once, under its latest change",
      [
        { name: "write", input: { path: "/repo/index.html" } },
        { name: "write", input: { path: "notes.md" } },
        { name: "edit", input: { path: "/repo/index.html" }, files: [{ file: "index.html", status: "modified" }] },
      ],
      [
        ["index.html", "html"],
        ["notes.md", "markdown"],
      ],
    ],
    [
      "follows every file of a patch, and drops one the patch deletes",
      [
        { name: "write", input: { path: "old.svg" } },
        {
          name: "patch",
          files: [
            { file: "new.svg", status: "added" },
            { file: "old.svg", status: "deleted" },
            { file: "readme.md", status: "modified" },
          ],
        },
      ],
      [
        ["readme.md", "markdown"],
        ["new.svg", "svg"],
      ],
    ],
  ])("%s", (_, calls, expected) => {
    expect(sessionArtifacts(session(calls), resolve).map((item) => [item.path, item.kind])).toEqual(expected)
  })

  test("a change to a listed file gives it the new revision", () => {
    const [first] = sessionArtifacts(session([{ name: "write", input: { path: "page.html" } }]), resolve)

    const [second] = sessionArtifacts(
      session([
        { name: "write", input: { path: "page.html" } },
        { name: "edit", input: { path: "page.html" } },
      ]),
      resolve,
    )

    expect(first?.revision).toBe("tool_0")
    expect(second?.revision).toBe("tool_1")
  })
})
