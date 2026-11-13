export * as ConfigPolicyPlugin from "./policy.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"
import { Config } from "../../config.js"
import { ConfigIntegration } from "../integration.js"
import { ManagedPolicy } from "../../managed-policy.js"
import { State } from "../../state.js"
import { Wildcard } from "../../util/wildcard.js"
import { ConfigEntryObserver } from "./entry-observer.js"

export const Plugin = define({
  id: "opencode.config.policy",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const reload = State.batch(
      Effect.all([ctx.integration.reload(), ctx.provider.reload(), ctx.mcp.reload(), ctx.skill.reload()], {
        discard: true,
      }),
    )
    const loaded = yield* ConfigEntryObserver.observe(config, ctx.event, reload)
    // Documents reverse so earlier-loaded policy wins: managed policy, then a Console config document, then user
    // and project files.
    const policies = () => ManagedPolicy.statements(loaded.entries)
    const runSync = Effect.runSyncWith(yield* Effect.context())
    yield* ctx.provider.transform((providers) => {
      const current = policies()
      const denied: string[] = []
      for (const record of providers.list()) {
        const policy = current.findLast(
          (policy) => policy.action === "provider.use" && Wildcard.match(record.provider.id, policy.resource),
        )
        if (policy?.effect !== "deny") continue
        providers.remove(record.provider.id)
        // Skip unconfigured catalog entries; deny-all policies would otherwise log the whole catalog.
        if (record.provider.activation === "enabled") denied.push(record.provider.id)
      }
      if (denied.length) runSync(Effect.logDebug("providers denied by policy", { providers: denied }))
    })
    // A denied provider is not offered for connection either. MCP servers follow `integration.use` instead, and an
    // integration that delivers a loaded config document keeps its place: removing it would drop the policy itself.
    yield* ctx.integration.transform((integrations) => {
      const current = policies()
      const delivering = new Set<string>(
        loaded.entries
          .filter((entry) => entry instanceof ConfigIntegration.Document)
          .map((entry) => entry.integrationID),
      )
      for (const integration of integrations.list()) {
        if (integration.metadata?.source === "mcp" || delivering.has(integration.id)) continue
        if (ManagedPolicy.decision(current, "provider.use", integration.id) === "deny")
          integrations.remove(integration.id)
      }
    })
    yield* ctx.mcp.transform((servers) => {
      const current = policies()
      for (const [name] of servers.list()) {
        if (ManagedPolicy.decision(current, "integration.use", `mcp:${name}`) === "deny") servers.remove(name)
      }
    })
    yield* ctx.skill.transform((skills) => {
      const current = policies()
      for (const skill of skills.list()) {
        if (ManagedPolicy.decision(current, "integration.use", `skill:${skill.id}`) === "deny") skills.remove(skill.id)
      }
    })
    yield* ctx.permission.hook("evaluate", (event) =>
      Effect.sync(() => {
        const current = policies()
        const denied = event.resources
          .map((resource) =>
            current.findLast(
              (policy) =>
                policy.action === "tool.use" && Wildcard.match(`${event.action}:${resource}`, policy.resource),
            ),
          )
          .find((policy) => policy?.effect === "deny")
        if (!denied) return
        event.effect = "deny"
        event.message = denied.message
      }),
    )
  }),
})
