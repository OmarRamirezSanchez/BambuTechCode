import { mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

/**
 * Writes a page's files into a new owner-only folder in the system's temporary directory and returns that folder and
 * the entry file's path. A name keeps no directory part, so no file lands outside the folder.
 */
export async function writePage(input: { entry: string; files: readonly { name: string; data: Uint8Array }[] }) {
  if (!input.files.some((file) => file.name === input.entry)) throw new Error("The page has no entry file")

  const directory = path.join(tmpdir(), `opencode-artifact-${crypto.randomUUID()}`)

  // Artifacts can hold anything the agent wrote; keep them owner-only in the shared temporary directory.
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await Promise.all(
    input.files.map((file) => writeFile(path.join(directory, fileName(file.name)), file.data, { mode: 0o600 })),
  )

  return { directory, entry: path.join(directory, fileName(input.entry)) }
}

/** The name without separators, dot segments or characters a supported file system refuses. */
function fileName(name: string) {
  return (
    name
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .replace(/^[. ]+|[. ]+$/g, "")
      .slice(-120) || "file"
  )
}
