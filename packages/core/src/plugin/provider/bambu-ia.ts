export * as BambuIA from "./bambu-ia.js"

import { Duration, Effect, Equal, FiberHandle, Schema, Scope, Semaphore, Stream } from "effect"
import { define } from "@opencode/plugin/effect/plugin"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { App } from "../../app.js"
import { Bus } from "../../bus.js"
import { Config } from "../../config.js"
import { ConfigIntegration } from "../../config/integration.js"
import { ConfigProviderPlugin } from "../../config/plugin/provider.js"
import { Credential } from "../../credential.js"
import { Integration } from "../../integration.js"
import { IntegrationConnection } from "../../integration/connection.js"
import { Provider } from "../../provider.js"

// BambuIAFrameWork is the governance gateway that every model call of RAD's governed runtime goes through. The RAD
// gateway exchanges the member's RAD session for a console credential; this plugin keeps that credential fresh,
// loads the models and policies RAD enabled for the member, and tags each model call with its work session.

export const integrationID = Integration.ID.make("bambu-ia")
const providerID = Provider.ID.make("bambu-ia")
const methodID = Integration.MethodID.make("rad")
const signedOutMessage = "Inicia sesión de nuevo con RAD para seguir usando BambuIAFrameWork"

/** Console session issued by the Framework's `/auth/exchange` and `/auth/refresh`. */
export const Session = Schema.Struct({
  token: Schema.String,
  expiresAt: Schema.String,
  refreshToken: Schema.String,
  refreshExpiresAt: Schema.String,
  consoleId: Schema.String,
  user: Schema.Struct({ id: Schema.Number, name: Schema.String, email: Schema.String }),
})
export type Session = typeof Session.Type
const Envelope = Schema.Struct({ data: Session })

class SignedOutError extends Schema.TaggedError<SignedOutError>()("BambuIA.SignedOut", {}) {
  override get message() {
    return `${signedOutMessage}.`
  }
}

/**
 * The Framework origin, from `BAMBU_IA_ORIGIN`. Only the governed runtime sets it, so plain BambuTechCode never
 * offers this integration. HTTPS is required except on loopback.
 */
export function origin() {
  const value = process.env.BAMBU_IA_ORIGIN
  if (!value) return undefined
  const url = new URL(value)
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    throw new Error("BAMBU_IA_ORIGIN requires HTTPS")
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`
}

/** The stored credential for a console session; the refresh token renews it without the member's RAD token. */
export function credential(session: Session) {
  return Credential.OAuth.make({
    type: "oauth",
    methodID,
    access: session.token,
    refresh: session.refreshToken,
    expires: Date.parse(session.expiresAt),
    metadata: {
      consoleID: session.consoleId,
      userID: session.user.id,
      name: session.user.name,
      email: session.user.email,
      sessionExpires: session.refreshExpiresAt,
    },
  })
}

export const BambuIAPlugin = define<HttpClient.HttpClient | Bus.Service | Config.Service | Scope.Scope>({
  id: "bambu.provider.bambu-ia",
  effect: Effect.fn(function* (ctx) {
    const server = origin()
    if (!server) return
    const bus = yield* Bus.Service
    const client = yield* HttpClient.HttpClient
    const http = HttpClient.mapRequest(client, HttpClientRequest.setHeader("User-Agent", App.useragent(ctx.app)))
    const config = yield* Config.Service
    const loading = Semaphore.makeUnsafe(1)
    type ActiveConnection = Effect.Success<ReturnType<typeof ctx.integration.connection.active>>
    let snapshot: { remote: ConfigIntegration.Remote | undefined; connection: ActiveConnection } = {
      remote: undefined,
      connection: undefined,
    }

    const load = Effect.fn("BambuIAPlugin.load")(function* () {
      const connection = yield* ctx.integration.connection.active(integrationID)
      if (!connection) return { remote: undefined, connection }
      const status = (value: IntegrationConnection.Status | undefined) =>
        ctx.integration.connection.status({ integrationID, connection, status: value })
      // Resolving refreshes a console token that is about to expire.
      return yield* ctx.integration.connection.resolve(connection).pipe(
        Effect.flatMap((value) =>
          value?.type === "oauth" ? fetchConfig(http, server, value.access) : Effect.succeed(undefined),
        ),
        Effect.map((remote) => ({ remote, connection })),
        Effect.tap(() => status(undefined)),
        Effect.catch((cause) =>
          Effect.gen(function* () {
            if (signedOut(cause)) yield* status({ status: "needs_auth", message: signedOutMessage })
            yield* Effect.logWarning("failed to load BambuIAFrameWork config", { cause })
            // Keep the last config of the same connection: dropping it would lift the Framework's provider policy.
            return {
              remote:
                IntegrationConnection.key(connection) === IntegrationConnection.key(snapshot.connection)
                  ? snapshot.remote
                  : undefined,
              connection,
            }
          }),
        ),
      )
    })
    let integrated: ConfigIntegration.Document | undefined
    const publish = Effect.fnUntraced(function* (next: typeof snapshot) {
      yield* config.integration?.(
        integrationID,
        next.remote &&
          next.connection &&
          ConfigIntegration.make({
            integrationID,
            connection:
              next.connection.type === "credential"
                ? { ...next.connection, id: Credential.ID.make(next.connection.id) }
                : next.connection,
            organization: "BambuIAFrameWork",
            info: next.remote,
          }),
      ) ?? Effect.void
      integrated = (yield* config.entries()).find(
        (entry): entry is ConfigIntegration.Document =>
          entry instanceof ConfigIntegration.Document && entry.integrationID === integrationID,
      )
    })

    yield* ctx.integration.transform((editor) => {
      editor.update(integrationID, (integration) => {
        integration.name = "BambuIAFrameWork"
      })
      editor.method.update({
        integrationID,
        method: { id: methodID, type: "oauth", label: "Sesión de RAD" },
        // The RAD gateway connects this integration when the member signs in; there is nothing to authorize here.
        authorize: () => Effect.fail(new Error("BambuIAFrameWork se conecta al iniciar sesión con RAD")),
        refresh: (value) => refresh(http, server, value),
        label: (value) => (typeof value.metadata?.email === "string" ? value.metadata.email : undefined),
      })
    })

    snapshot = yield* load()
    yield* publish(snapshot)
    yield* ctx.provider.transform((providers) => {
      if (integrated) ConfigProviderPlugin.integrate(providers, integrated)
    })
    // The Framework groups calls into work sessions by this header.
    yield* ctx.session.hook(
      "model.request",
      (event) =>
        Effect.sync(() => {
          event.headers["x-bambu-session"] = event.sessionID
        }),
      { providerID },
    )

    const apply = Effect.fn("BambuIAPlugin.apply")(function* (next: typeof snapshot) {
      snapshot = next
      yield* publish(next)
      yield* Effect.all([ctx.provider.reload(), ctx.mcp.reload()], { concurrency: 2, discard: true })
    })
    const check = () =>
      loading.withPermit(
        Effect.gen(function* () {
          const next = yield* load()
          if (!Equal.equals(snapshot, next)) yield* apply(next)
        }),
      )
    // RAD changes enabled models and policies independently of this machine, so re-fetch every minute while
    // connected and rebuild the catalog only when the document changed.
    const polling = yield* FiberHandle.make<void, never>()
    const poll = Effect.fnUntraced(function* () {
      if (!snapshot.connection) return yield* FiberHandle.clear(polling)
      yield* FiberHandle.run(polling, Effect.sleep(Duration.minutes(1)).pipe(Effect.andThen(check()), Effect.forever), {
        onlyIfMissing: true,
      })
    })
    yield* bus.subscribe(Credential.Event.Switched).pipe(
      Stream.filter((event) => event.data.integrationID === integrationID),
      Stream.runForEach(() => loading.withPermit(load().pipe(Effect.andThen(apply))).pipe(Effect.andThen(poll()))),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* poll()
  }),
})

function signedOut(cause: unknown) {
  return (
    cause instanceof SignedOutError ||
    (cause instanceof Integration.AuthorizationError && cause.cause instanceof SignedOutError)
  )
}

function fetchConfig(http: HttpClient.HttpClient, server: string, token: string) {
  return HttpClient.withScope(http)
    .execute(
      HttpClientRequest.get(`${server}/v1/config`).pipe(
        HttpClientRequest.acceptJson,
        HttpClientRequest.bearerToken(token),
      ),
    )
    .pipe(
      Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
      Effect.flatMap((response) =>
        Effect.gen(function* () {
          if (response.status === 401) return yield* new SignedOutError()
          const body = yield* HttpClientResponse.filterStatusOk(response).pipe(Effect.flatMap((ok) => ok.json))
          return yield* Schema.decodeUnknownEffect(ConfigIntegration.Remote)(body)
        }),
      ),
      Effect.scoped,
    )
}

function refresh(http: HttpClient.HttpClient, server: string, value: Credential.OAuth) {
  return HttpClientRequest.post(`${server}/auth/refresh`).pipe(
    HttpClientRequest.acceptJson,
    HttpClientRequest.schemaBodyJson(Schema.Struct({ refreshToken: Schema.String }))({ refreshToken: value.refresh }),
    Effect.flatMap((request) =>
      HttpClient.withScope(http)
        .execute(request)
        .pipe(
          Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
          Effect.flatMap((response) =>
            Effect.gen(function* () {
              // The session ended or was revoked; only a new RAD sign-in recovers.
              if (response.status === 401) return yield* new SignedOutError()
              const ok = yield* HttpClientResponse.filterStatusOk(response)
              return credential((yield* HttpClientResponse.schemaBodyJson(Envelope)(ok)).data)
            }),
          ),
          Effect.scoped,
        ),
    ),
  )
}
