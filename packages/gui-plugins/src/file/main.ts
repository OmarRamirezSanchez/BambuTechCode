import { rm } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { shell } from "electron"
import type { Plugin } from "@opencode/plugin/gui/main"
import { SystemBrowser } from "./contract"
import { writePage } from "./temp-page"

const setup: Plugin.MainSetup = (ctx) => {
  // The folders this instance wrote. The browser loaded each page when it opened, so they go with the instance.
  const folders = new Set<string>()

  ctx.provide(SystemBrowser, {
    open: async (input) => {
      const page = await writePage(input)

      folders.add(page.directory)
      await shell.openExternal(pathToFileURL(page.entry).href)
    },
  })

  ctx.onCleanup(async () => {
    await Promise.all([...folders].map((folder) => rm(folder, { recursive: true, force: true })))
  })
}

export default setup
