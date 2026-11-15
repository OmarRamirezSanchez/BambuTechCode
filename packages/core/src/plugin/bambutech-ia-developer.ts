export * as BambuTechIADeveloperPlugin from "./bambutech-ia-developer.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Global } from "@opencode/util/global"
import { Effect } from "effect"
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "path"
import { brotliDecompressSync } from "node:zlib"
import { Agent } from "../agent.js"
import { ConfigMarkdown } from "../config/markdown.js"
import { SkillFile } from "../config/plugin/skill-file.js"
import { which } from "../util/which.js"
import bundle from "./bambutech-ia-developer/bundle.txt" with { type: "text" }
import source from "./bambutech-ia-developer/source.js"

// BambuTech IA Developer (requirements, architecture, development, quality, security and E2E agents coordinated by
// the `bambutech-develop` skill) ships with BambuTechCode. Its skill reads scripts and references relative to its own
// directory, so the embedded copy is written once per version under the data directory and registered from there.
// Refresh it with `bun run script/sync-bambutech-ia-developer.ts <plugin directory>` from packages/core.

export const id = "bambutech.ia-developer"
export const mcpServer = "codebase-memory-mcp"

export const Plugin = define({
  id,
  effect: Effect.fn(function* (ctx) {
    const global = yield* Global.Service
    const loaded = yield* load(
      path.join(global.data, "plugins", source.name, `${source.version}-${source.sha256.slice(0, 12)}`),
    ).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("BambuTech IA Developer could not be loaded", { cause }).pipe(Effect.as(undefined)),
      ),
    )
    if (!loaded) return

    yield* ctx.skill.transform((editor) => {
      if (!editor.get(loaded.skill.id)) editor.add(loaded.skill)
    })

    yield* ctx.agent.transform((editor) => {
      for (const profile of loaded.agents) {
        const agentID = Agent.ID.make(profile.name)
        if (editor.get(agentID)) continue
        editor.update(agentID, (item) => {
          item.name = Agent.Name.make(profile.name)
          item.description = profile.description
          item.system = profile.system
          item.mode = "subagent"
          // Profiles return questions to the coordinator instead of asking the human themselves.
          item.permissions.push({ action: "question", resource: "*", effect: "deny" })
          // Claude Code tool names; only the ones that change what a profile may do are mapped.
          if (!profile.tools.includes("Agent"))
            item.permissions.push({ action: "subagent", resource: "*", effect: "deny" })
          if (!profile.tools.includes("WebFetch"))
            item.permissions.push({ action: "webfetch", resource: "*", effect: "deny" })
          if (!profile.tools.includes("WebSearch"))
            item.permissions.push({ action: "websearch", resource: "*", effect: "deny" })
        })
      }
    })

    // The launcher reuses a native codebase-memory-mcp install or runs the pinned npm release, so it needs Node.
    // A server of the same name in config takes precedence, including one that disables it.
    if (!which("node")) return
    yield* ctx.mcp.transform((editor) => {
      if (editor.get(mcpServer)) return
      editor.set(mcpServer, { type: "local", command: ["node", path.join(loaded.root, "mcp", "codebase-memory.mjs")] })
    })
  }),
})

const load = Effect.fn("BambuTechIADeveloperPlugin.load")(function* (root: string) {
  yield* install(root)
  const skillFile = path.join(root, "skills", "bambutech-develop", "SKILL.md")
  const skill = SkillFile.parse(path.dirname(skillFile), skillFile, yield* read(skillFile))
  if (skill._tag !== "Parsed") return yield* Effect.die(new Error(`Invalid skill: ${skillFile}`))
  const files = (yield* Effect.promise(() => readdir(path.join(root, "agents")))).filter((file) => file.endsWith(".md"))
  const agents = yield* Effect.forEach(files.toSorted(), (file) =>
    read(path.join(root, "agents", file)).pipe(
      Effect.map((content) => {
        const markdown = ConfigMarkdown.parse(content)
        return {
          name: String(markdown.data.name ?? path.basename(file, ".md")),
          description: String(markdown.data.description ?? ""),
          system: markdown.content.trim(),
          tools: String(markdown.data.tools ?? "")
            .split(",")
            .map((tool) => tool.trim()),
        }
      }),
    ),
  )
  return { root, skill: skill.skill, agents }
})

const read = (file: string) => Effect.promise(() => readFile(file, "utf8"))

const isDirectory = (target: string) =>
  stat(target).then(
    (info) => info.isDirectory(),
    () => false,
  )

const install = Effect.fn("BambuTechIADeveloperPlugin.install")(function* (target: string) {
  if (yield* Effect.promise(() => isDirectory(target))) return
  const files: Record<string, string> = JSON.parse(
    brotliDecompressSync(Buffer.from(bundle, "base64")).toString("utf8"),
  ).files
  // Write beside the target and rename, so a concurrent process never registers a partial copy.
  const staging = `${target}.${process.pid}.tmp`
  yield* Effect.promise(async () => {
    await rm(staging, { recursive: true, force: true })
    for (const [key, content] of Object.entries(files)) {
      const file = path.join(staging, ...key.split("/"))
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, content)
    }
    await rename(staging, target).catch(async (error) => {
      await rm(staging, { recursive: true, force: true })
      // Another process installed the same version first.
      if (!(await isDirectory(target))) throw error
    })
  })
})
