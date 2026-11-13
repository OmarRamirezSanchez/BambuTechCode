import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { Agent } from "@opencode/core/agent"
import { Config } from "@opencode/core/config"
import { ConfigIntegration } from "@opencode/core/config/integration"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { PluginHost } from "@opencode/core/plugin/host"
import { BambuIAPlugin, credential, integrationID } from "@opencode/core/plugin/provider/bambu-ia"
import { Provider } from "@opencode/core/provider"
import { Session } from "@opencode/core/session"
import { withEnv } from "../fixture/env"
import { drain } from "../lib/clock"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

// Periodic checks run on TestClock; calling the server in-process keeps each request within `drain`.
const inProcess = (server: { fetch: (request: Request) => Response | Promise<Response> }) =>
  Effect.provideService(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      HttpClientRequest.toWeb(request).pipe(
        Effect.orDie,
        Effect.flatMap((web) => Effect.promise(async () => server.fetch(web))),
        Effect.map((response) => HttpClientResponse.fromWeb(request, response)),
      ),
    ),
  )

const addPlugin = (origin: string | undefined) =>
  withEnv({ BAMBU_IA_ORIGIN: origin }, () =>
    Effect.gen(function* () {
      const plugin = yield* Plugin.Service
      yield* BambuIAPlugin.effect(yield* PluginHost.make(plugin))
    }),
  )

const session = (token: string, refreshToken: string, expiresAt: string) => ({
  token,
  expiresAt,
  refreshToken,
  refreshExpiresAt: "2099-01-01T00:00:00.000Z",
  consoleId: "6f1d1f43-2b52-4a43-9d3e-0f3f1e4f5a10",
  user: { id: 42, name: "Diego Dev", email: "diego@example.com" },
})

const providerID = Provider.ID.make("bambu-ia")

function framework() {
  const state = {
    models: { sonnet: { name: "Claude Sonnet 5.5", modelID: "us.anthropic.claude-sonnet-5-5-v1:0" } } as Record<
      string,
      { name: string; modelID: string }
    >,
    rejectRefresh: false,
    refreshes: [] as unknown[],
    configs: [] as (string | null)[],
  }
  const server = Bun.serve({
    port: 0,
    fetch: async (request: Request) => {
      const url = new URL(request.url)
      const path = url.pathname
      if (path === "/auth/refresh") {
        state.refreshes.push(await request.json())
        if (state.rejectRefresh) return Response.json({ message: "Tu sesión venció" }, { status: 401 })
        return Response.json({
          data: session(
            `access-${state.refreshes.length + 1}`,
            `refresh-${state.refreshes.length + 1}`,
            "2099-01-01T00:00:00.000Z",
          ),
        })
      }
      if (path === "/v1/config") {
        state.configs.push(request.headers.get("authorization"))
        return Response.json({
          providers: {
            "bambu-ia": {
              name: "BambuIAFrameWork",
              canonical: "amazon-bedrock",
              package: "@opencode/ai/providers/amazon-bedrock",
              settings: { baseURL: `${url.origin}/v1/bedrock`, region: "us-east-1", auth: "bearer" },
              models: state.models,
            },
          },
          policies: [
            { action: "provider.use", resource: "*", effect: "deny" },
            { action: "provider.use", resource: "bambu-ia", effect: "allow" },
            { action: "tool.use", resource: "bash:*", effect: "deny" },
          ],
        })
      }
      return new Response("Not found", { status: 404 })
    },
  })
  return { server, state }
}

const integrated = (config: Config.Interface) =>
  config
    .entries()
    .pipe(
      Effect.map((entries) =>
        entries.find(
          (entry): entry is ConfigIntegration.Document =>
            entry instanceof ConfigIntegration.Document && entry.integrationID === integrationID,
        ),
      ),
    )

describe("BambuIAPlugin", () => {
  it.effect("stays out of BambuTechCode outside RAD's governed runtime", () =>
    Effect.gen(function* () {
      yield* addPlugin(undefined)
      const integrations = yield* Integration.Service
      expect(yield* integrations.get(integrationID)).toBeUndefined()
    }),
  )

  it.effect("renews the console token, loads the member's models and policies, and follows RAD's changes", () =>
    Effect.acquireUseRelease(
      Effect.sync(framework),
      ({ server, state }) =>
        Effect.gen(function* () {
          const credentials = yield* Credential.Service
          const providers = yield* Provider.Service
          const config = yield* Config.Service
          // An expired console token: loading must renew it with the refresh token before asking for config.
          const created = yield* credentials.create({
            integrationID,
            value: credential(session("access-1", "refresh-1", new Date(0).toISOString())),
          })
          yield* addPlugin(server.url.origin).pipe(inProcess(server))
          yield* drain

          expect(state.refreshes).toEqual([{ refreshToken: "refresh-1" }])
          expect(state.configs).toEqual(["Bearer access-2"])
          const stored = yield* credentials.get(created.id)
          expect(stored?.value).toMatchObject({ type: "oauth", access: "access-2", refresh: "refresh-2" })

          expect(yield* providers.get(providerID)).toMatchObject({
            name: "BambuIAFrameWork",
            package: "@opencode/ai/providers/amazon-bedrock",
            settings: { baseURL: `${server.url.origin}/v1/bedrock`, auth: "bearer" },
          })
          expect((yield* integrated(config))?.info.policies).toEqual([
            { action: "provider.use", resource: "*", effect: "deny" },
            { action: "provider.use", resource: "bambu-ia", effect: "allow" },
            { action: "tool.use", resource: "bash:*", effect: "deny" },
          ])
          expect(Object.keys((yield* integrated(config))?.info.providers?.["bambu-ia"]?.models ?? {})).toEqual([
            "sonnet",
          ])

          // RAD enables another model: the next minute's check picks it up without a new sign-in.
          state.models = {
            ...state.models,
            opus: { name: "Claude Opus 5.5", modelID: "us.anthropic.claude-opus-5-5-v1:0" },
          }
          yield* TestClock.adjust("1 minute")
          yield* drain
          expect(state.configs).toEqual(["Bearer access-2", "Bearer access-2"])
          expect(Object.keys((yield* integrated(config))?.info.providers?.["bambu-ia"]?.models ?? {})).toEqual([
            "sonnet",
            "opus",
          ])
          expect(state.refreshes).toHaveLength(1)
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.effect("tags only the Framework's model calls with the work session", () =>
    Effect.acquireUseRelease(
      Effect.sync(framework),
      ({ server }) =>
        Effect.gen(function* () {
          const credentials = yield* Credential.Service
          const hooks = yield* PluginHooks.Service
          yield* credentials.create({
            integrationID,
            value: credential(session("access-1", "refresh-1", "2099-01-01T00:00:00.000Z")),
          })
          yield* addPlugin(server.url.origin).pipe(inProcess(server))
          yield* drain
          const headers = (provider: Provider.ID) =>
            hooks
              .trigger("session", "model.request", {
                sessionID: Session.ID.make("ses_work"),
                agent: Agent.ID.make("build"),
                model: Model.Ref.make({ providerID: provider, id: Model.ID.make("sonnet") }),
                kind: "primary",
                headers: {},
              })
              .pipe(Effect.map((event) => event.headers))
          expect(yield* headers(providerID)).toEqual({ "x-bambu-session": "ses_work" })
          expect(yield* headers(Provider.ID.make("amazon-bedrock"))).toEqual({})
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.effect("asks the member to sign in with RAD again once the Framework ends the session", () =>
    Effect.acquireUseRelease(
      Effect.sync(framework),
      ({ server, state }) =>
        Effect.gen(function* () {
          const credentials = yield* Credential.Service
          const integrations = yield* Integration.Service
          state.rejectRefresh = true
          yield* credentials.create({
            integrationID,
            value: credential(session("access-1", "refresh-1", new Date(0).toISOString())),
          })
          yield* addPlugin(server.url.origin).pipe(inProcess(server))
          yield* drain
          expect(state.configs).toEqual([])
          expect((yield* integrations.get(integrationID))?.connections[0]?.status).toEqual({
            status: "needs_auth",
            message: "Inicia sesión de nuevo con RAD para seguir usando BambuIAFrameWork",
          })
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )
})
