import { renderCachedMarkdown } from "@opencode/session-ui/markdown-cache"
import { artifactMime, type ArtifactKind } from "@opencode/util/artifact"
import { getFilename } from "@opencode/util/path"
import type { FileContent, MountedSession, SetupContext } from "@opencode/plugin/gui"
import { bytesFromContent } from "./artifact"
import { MAX_PAGE_BYTES, SystemBrowser } from "./contract"
import { framePage, markdownPage, sandboxPage } from "./page"
import { pathToFileUrl, resolveOpenInAppPath } from "./path"
import type File from "./index"

/** How long a new tab has to load the blob URLs of its page before the window lets them go. */
const BLOB_LIFETIME = 60_000

/**
 * Opens an artifact in the system's default browser. The desktop opens an HTML file of its own server where it lies,
 * so its relative assets load and a reload shows the agent's latest version; anything else becomes a page that main
 * writes to a temporary folder. The web opens the page in a new tab. Rejects when the page cannot open.
 */
export async function openInSystemBrowser(
  ctx: SetupContext<typeof File>,
  input: { session: MountedSession; root: string; path: string; kind: ArtifactKind; content: FileContent },
) {
  const name = getFilename(input.path)

  if (ctx.desktop && input.kind === "html" && input.session.server.builtin)
    return ctx.system.openExternal(pathToFileUrl(resolveOpenInAppPath(input.root, input.path)))

  const data = await contentBytes(input.content, ctx.signal)

  if (data.byteLength > MAX_PAGE_BYTES) throw new Error("The artifact is too large to open in the browser")

  const text = () => new TextDecoder().decode(data)

  const markdown = async () => {
    const rendered = await renderCachedMarkdown({ raw: text(), src: text() }, undefined, ctx.signal)
    const style = getComputedStyle(document.documentElement)

    return markdownPage({
      title: name,
      html: rendered.html,
      fonts: {
        sans: style.getPropertyValue("--font-family-sans"),
        mono: style.getPropertyValue("--font-family-mono"),
      },
    })
  }

  if (ctx.desktop) {
    const browser = ctx.main(SystemBrowser)
    const page = `${name}.html`
    const encode = (value: string) => new TextEncoder().encode(value)

    const open = (files: { name: string; data: Uint8Array }[], entry: string) =>
      browser.open({ entry, files }, { signal: ctx.signal })

    if (input.kind === "html") return open([{ name, data }], name)

    if (input.kind === "markdown") return open([{ name: page, data: encode(await markdown()) }], page)

    // The page shows the file beside it by its name.
    return open(
      [
        { name, data },
        { name: page, data: encode(framePage({ title: name, kind: frameKind(input.kind), src: name })) },
      ],
      page,
    )
  }

  const urls: string[] = []

  const blob = (value: BlobPart, type: string) => {
    const url = URL.createObjectURL(new Blob([value], { type }))

    urls.push(url)

    return url
  }

  const page =
    input.kind === "html" || input.kind === "markdown"
      ? sandboxPage({ title: name, html: input.kind === "html" ? text() : await markdown() })
      : framePage({
          title: name,
          kind: frameKind(input.kind),
          src: blob(new Uint8Array(data), artifactMime(input.path) ?? "application/octet-stream"),
        })

  window.open(blob(page, "text/html"), "_blank", "noopener,noreferrer")

  const revoke = () => urls.forEach((url) => URL.revokeObjectURL(url))
  const timer = setTimeout(revoke, BLOB_LIFETIME)

  ctx.signal.addEventListener(
    "abort",
    () => {
      clearTimeout(timer)
      revoke()
    },
    { once: true },
  )
}

/** The file's bytes. Images stream from the server instead of loading into the file model, so they are read here. */
async function contentBytes(content: FileContent, signal: AbortSignal) {
  if (!content.url) return bytesFromContent(content)

  const response = await fetch(content.url, { signal })

  if (!response.ok) throw new Error(`The artifact could not be read: ${response.status}`)

  return new Uint8Array(await response.arrayBuffer())
}

function frameKind(kind: ArtifactKind) {
  return kind === "svg" || kind === "pdf" ? kind : "image"
}
