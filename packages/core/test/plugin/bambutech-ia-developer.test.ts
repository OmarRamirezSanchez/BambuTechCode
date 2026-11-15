import { afterAll, expect } from "bun:test"
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import os from "node:os"
import path from "path"
import { Effect, Layer, Types } from "effect"
import { Agent } from "@opencode/core/agent"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { BambuTechIADeveloperPlugin } from "@opencode/core/plugin/bambutech-ia-developer"
import { Skill } from "@opencode/core/skill"
import type { Mcp } from "@opencode/schema/mcp"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { testEffect } from "../lib/effect"
import { agentHost, host } from "./host"

const data = mkdtempSync(path.join(os.tmpdir(), "opencode-bambutech-ia-developer-"))
afterAll(() => rmSync(data, { recursive: true, force: true }))
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Agent.node, Skill.node])) as unknown as Layer.Layer<
    Agent.Service | Skill.Service,
    never
  >,
)

const run = (servers: Map<string, Types.DeepMutable<Mcp.ServerConfig>>) =>
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const skill = yield* Skill.Service
    yield* BambuTechIADeveloperPlugin.Plugin.effect(
      host({
        agent: agentHost(agent),
        skill: { list: () => Effect.die("unused skill.list"), transform: skill.transform, reload: skill.reload },
        mcp: {
          ...host().mcp,
          transform: (transform) =>
            Effect.sync(() => {
              transform({
                list: () => [...servers],
                get: (name) => servers.get(name),
                set: (name, config) => {
                  servers.set(name, structuredClone(config) as Types.DeepMutable<Mcp.ServerConfig>)
                },
                update: (name, update) => {
                  const server = servers.get(name)
                  if (server) update(server)
                },
                remove: (name) => {
                  servers.delete(name)
                },
              })
              return { dispose: Effect.void }
            }),
        },
      }),
    ).pipe(Effect.provideService(Global.Service, Global.Service.of(Global.make({ data }))))
    return { agent, skill }
  })

it.effect("installs the embedded plugin and registers its skill, agents and code-context server", () =>
  Effect.gen(function* () {
    const servers = new Map<string, Types.DeepMutable<Mcp.ServerConfig>>()
    const { agent, skill } = yield* run(servers)

    const develop = yield* skill.get(Skill.ID.make("bambutech-develop"))
    expect(develop?.description).toContain("BambuTech")
    // The skill's relative references must exist beside the registered SKILL.md.
    const root = path.dirname(develop!.path)
    expect(readdirSync(path.join(root, "references"))).toContain("protocol.md")
    expect(readdirSync(path.join(root, "resources", "upstream"))).toContain("archify")

    const agents = (yield* agent.list()).filter((item) => item.id.startsWith("bambu-"))
    expect(agents.map((item) => String(item.id)).toSorted()).toEqual([
      "bambu-architecture",
      "bambu-developer",
      "bambu-e2e",
      "bambu-implementation-worker",
      "bambu-quality",
      "bambu-requirements",
      "bambu-security",
    ])
    for (const item of agents) {
      expect(item.mode).toBe("subagent")
      expect(item.system).toContain("skill_root")
      expect(item.permissions).toContainEqual({ action: "question", resource: "*", effect: "deny" })
    }
    const permissions = (id: string) => agents.find((item) => item.id === id)!.permissions
    expect(permissions("bambu-developer")).not.toContainEqual({ action: "subagent", resource: "*", effect: "deny" })
    expect(permissions("bambu-quality")).toContainEqual({ action: "subagent", resource: "*", effect: "deny" })
    expect(permissions("bambu-architecture")).not.toContainEqual({ action: "websearch", resource: "*", effect: "deny" })
    expect(permissions("bambu-quality")).toContainEqual({ action: "websearch", resource: "*", effect: "deny" })

    const server = servers.get(BambuTechIADeveloperPlugin.mcpServer)
    if (Bun.which("node"))
      expect(server).toEqual({
        type: "local",
        command: ["node", path.join(path.dirname(path.dirname(root)), "mcp", "codebase-memory.mjs")],
      })
  }),
)

it.effect("keeps a configured code-context server and reuses the installed copy", () =>
  Effect.gen(function* () {
    const configured: Types.DeepMutable<Mcp.ServerConfig> = {
      type: "local",
      command: ["codebase-memory-mcp"],
      disabled: true,
    }
    const servers = new Map([[BambuTechIADeveloperPlugin.mcpServer, configured]])
    yield* run(new Map())
    const before = readdirSync(path.join(data, "plugins", "bambutech-ia-developer"))
    yield* run(servers)

    expect(servers.get(BambuTechIADeveloperPlugin.mcpServer)).toBe(configured)
    expect(readdirSync(path.join(data, "plugins", "bambutech-ia-developer"))).toEqual(before)
  }),
)
