#!/usr/bin/env bun
import { $ } from "bun"
import { exists } from "node:fs/promises"
import path from "node:path"
import { copyBuiltCliToResources, getCurrentCli, resolveChannel } from "./utils"

// Prepares resources/ (icons, metainfo, the bundled CLI) for OPENCODE_CHANNEL and builds the app into out/.
// Every Bambu channel bundles the local fork CLI; never download an upstream distribution.
const dir = path.resolve(import.meta.dir, "..")

const cli = path.resolve(dir, "../cli/dist")

const channel = resolveChannel()

process.chdir(dir)

await $`bun ./script/copy-icons.ts ${channel}`

await $`bun ./script/copy-metainfo.ts ${channel}`

const built = await exists(path.join(cli, getCurrentCli().package.replace("@opencode/", "")))

if (!built) throw new Error(`Bambu desktop builds bundle the CLI from ${cli}; build it first`)

await copyBuiltCliToResources(cli)

await $`bunx electron-vite build`
