/** The user's UI and code fonts, resolved from the app's font variables when the page is built. */
export type PageFonts = { sans: string; mono: string }

/**
 * A page that shows one image, SVG or PDF from `src`. Opening this page, rather than the file, makes the system
 * browser show it instead of whichever program the system pairs with the file's type. An `<img>` never runs an SVG's
 * scripts.
 */
export function framePage(input: { title: string; kind: "image" | "svg" | "pdf"; src: string }) {
  const body =
    input.kind === "pdf"
      ? `<iframe src="${escape(input.src)}" title="${escape(input.title)}"></iframe>`
      : `<img src="${escape(input.src)}" alt="${escape(input.title)}">`

  return document(input.title, `html,body{height:100%;margin:0}${frameStyle}`, body)
}

/** A readable page around Markdown already rendered to sanitized HTML. */
export function markdownPage(input: { title: string; html: string; fonts: PageFonts }) {
  const style = [
    `body{margin:0;font-family:${cssValue(input.fonts.sans)};line-height:1.6;color:#1f2328;background:#fff}`,
    "main{box-sizing:border-box;max-width:880px;margin:0 auto;padding:48px 32px}",
    `pre,code{font-family:${cssValue(input.fonts.mono)};font-size:0.9em}`,
    "pre{overflow:auto;padding:16px;border-radius:8px;background:#f6f8fa}",
    "img,svg{max-width:100%}table{border-collapse:collapse}th,td{border:1px solid #d0d7de;padding:6px 12px}",
    "@media (prefers-color-scheme:dark){body{color:#e6edf3;background:#0d1117}pre{background:#161b22}th,td{border-color:#30363d}}",
  ].join("")

  return document(input.title, style, `<main>${input.html}</main>`)
}

/**
 * A page that runs an HTML document in a sandboxed frame. On the web a page the app opens shares the app's origin, so
 * the document runs as an opaque origin, as it does in the file view: no app storage, cookies or credentials reach it.
 */
export function sandboxPage(input: { title: string; html: string }) {
  return document(
    input.title,
    `html,body{height:100%;margin:0}${frameStyle}`,
    `<iframe sandbox="allow-scripts allow-popups allow-forms allow-modals" referrerpolicy="no-referrer" srcdoc="${escape(input.html)}" title="${escape(input.title)}"></iframe>`,
  )
}

const frameStyle =
  "body{display:flex;align-items:center;justify-content:center;background:#fff}iframe{width:100%;height:100%;border:0}img{max-width:100%;max-height:100%}"

function document(title: string, style: string, body: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>${style}</style></head><body>${body}</body></html>`
}

/** Escapes text for element content and double-quoted attributes. */
function escape(text: string) {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
}

/** A font stack from a CSS variable, unable to close the declaration or the style element it sits in. */
function cssValue(value: string) {
  return value.replace(/[;{}<>]/g, "").trim() || "inherit"
}
