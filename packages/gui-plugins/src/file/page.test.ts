import { describe, expect, test } from "bun:test"
import { framePage, markdownPage, sandboxPage } from "./page"

const hostile = `"><script>alert(1)</script>`

describe("pages for the system browser", () => {
  // On the web these pages share the app's origin, so nothing an artifact names may become markup of the page itself.
  test.each([
    ["a frame's title and source", framePage({ title: hostile, kind: "svg", src: hostile })],
    ["a PDF frame's title and source", framePage({ title: hostile, kind: "pdf", src: hostile })],
    ["a sandboxed document and its title", sandboxPage({ title: hostile, html: hostile })],
    [
      "Markdown's title and fonts",
      markdownPage({ title: hostile, html: "<p>ok</p>", fonts: { sans: `x}</style>${hostile}`, mono: hostile } }),
    ],
  ])("%s stay text", (_, page) => {
    expect(page).not.toContain("<script>")
  })

  test("a sandboxed document runs as an opaque origin", () => {
    const page = sandboxPage({ title: "page.html", html: "<p>hi</p>" })
    const sandbox = page.match(/sandbox="([^"]*)"/)?.[1]

    expect(sandbox?.split(" ")).not.toContain("allow-same-origin")
    expect(page).toContain(`srcdoc="&#60;p&#62;hi&#60;/p&#62;"`)
  })
})
