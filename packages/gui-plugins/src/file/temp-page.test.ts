import { expect, test } from "bun:test"
import { readdir, readFile, rm } from "node:fs/promises"
import path from "node:path"
import { writePage } from "./temp-page"

const bytes = (text: string) => new TextEncoder().encode(text)

test("a page's files stay inside its own folder, and its entry is one of them", async () => {
  const page = await writePage({
    entry: "../chart.svg.html",
    files: [
      { name: "../../chart.svg", data: bytes("<svg/>") },
      { name: "../chart.svg.html", data: bytes("<img src='chart.svg'>") },
      { name: "C:\\Windows\\win.ini", data: bytes("x") },
      { name: "..", data: bytes("y") },
    ],
  })

  try {
    // All four landed in the folder itself: none climbed out or named a drive.
    expect(await readdir(page.directory)).toHaveLength(4)
    expect(path.dirname(page.entry)).toBe(page.directory)
    expect(await readFile(page.entry, "utf8")).toBe("<img src='chart.svg'>")
  } finally {
    await rm(page.directory, { recursive: true, force: true })
  }

  await expect(writePage({ entry: "missing.html", files: [{ name: "page.html", data: bytes("") }] })).rejects.toThrow(
    "no entry file",
  )
})
