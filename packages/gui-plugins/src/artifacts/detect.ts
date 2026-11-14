import type { SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client/promise"
import { artifactKind, isAgentArtifact, type ArtifactKind } from "@opencode/util/artifact"
import { Option, Schema } from "effect"

/** A file the session's agent wrote or edited that renders as a page. */
export type SessionArtifact = {
  /** The file as the session screen's file model resolves it: workspace-relative, or absolute outside it. */
  readonly path: string
  readonly kind: ArtifactKind
  /** The tool call that last changed the file; another one each time the agent changes it again. */
  readonly revision: string
  /** When the agent last changed the file. */
  readonly time: number
}

/**
 * The artifacts a session's agent produced, most recently changed first. A completed write, edit or patch of a file of
 * an artifact kind lists it, and a patch that deletes the file drops it. Failed and unfinished calls change nothing.
 *
 * @param messages - The session's loaded messages, oldest first.
 * @param resolve - Normalizes a tool's path, which may be relative or absolute, to one key per file.
 */
export function sessionArtifacts(messages: readonly SessionMessageInfo[], resolve: (path: string) => string) {
  const artifacts = new Map<string, SessionArtifact>()

  messages
    .flatMap((message) => (message.type === "assistant" ? message.content : []))
    .filter((item): item is SessionMessageAssistantTool => item.type === "tool" && item.state.status === "completed")
    .flatMap((tool) => changes(tool).map((change) => ({ ...change, tool })))
    .forEach((change) => {
      const path = resolve(change.path)

      // Moving the entry to the end keeps the map in change order.
      artifacts.delete(path)

      if (change.deleted || !isAgentArtifact(path)) return
      artifacts.set(path, {
        path,
        kind: artifactKind(path),
        revision: change.tool.id,
        time: change.tool.time.completed ?? change.tool.time.created,
      })
    })

  return [...artifacts.values()].reverse()
}

const decodeInput = Schema.decodeUnknownOption(Schema.Struct({ path: Schema.String }))

const decodeFiles = Schema.decodeUnknownOption(Schema.Struct({ files: Schema.Array(Schema.Unknown) }))

const decodeFile = Schema.decodeUnknownOption(
  Schema.Struct({ file: Schema.String, status: Schema.optional(Schema.Literals(["added", "deleted", "modified"])) }),
)

/** The files one completed tool call changed: the patch metadata when it lists them, else the input's path. */
function changes(tool: SessionMessageAssistantTool) {
  if (tool.name !== "write" && tool.name !== "edit" && tool.name !== "patch") return []

  const files = Option.match(decodeFiles("metadata" in tool.state ? tool.state.metadata : undefined), {
    onNone: () => [],
    onSome: (metadata) => metadata.files.flatMap((file) => Option.toArray(decodeFile(file))),
  })

  if (files.length > 0) return files.map((file) => ({ path: file.file, deleted: file.status === "deleted" }))

  if (tool.name === "patch") return []

  return Option.toArray(decodeInput(tool.state.input)).map((input) => ({ path: input.path, deleted: false }))
}
