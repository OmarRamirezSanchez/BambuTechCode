export * as SessionBrief from "./brief.js"

import { Context, Effect, Layer, Option, Schema } from "effect"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Bus } from "../bus.js"
import { Config } from "../config.js"
import type { MessageDecodeError } from "./error.js"
import { SessionEvent } from "./event.js"
import type { SessionMessage } from "./message.js"
import { SessionSchema } from "./schema.js"
import { SessionStore } from "./store.js"

/**
 * The work-session brief: the structure every new conversation starts from. The first prompt of a
 * top-level Session, and the first after the user compacts one, is checked against these sections
 * before the model works on it. The check is textual; whether the content is sufficient is left to
 * the model, which the injected guidance tells to propose a prompt, ask for specifics, or interview.
 */
export const SECTIONS = [
  { key: "objetivo", title: "Objetivo", label: "objetivo" },
  { key: "descripcion", title: "Descripción", label: "descripcion" },
  { key: "contexto", title: "Contexto", label: "contexto" },
  { key: "criterios", title: "Criterios de Aceptación", label: "criterios de aceptacion" },
] as const

export type Section = (typeof SECTIONS)[number]
export type Key = Section["key"]
export type Reason = "missing" | "empty"
/** "new" is a Session's first prompt; "cleared" is the first prompt after the user compacted it. */
export type Boundary = "new" | "cleared"

export interface Gap {
  readonly key: Key
  readonly title: string
  readonly reason: Reason
}

export interface Evaluation {
  readonly complete: boolean
  readonly gaps: ReadonlyArray<Gap>
}

export const TEMPLATE = [
  "## Objetivo :",
  "// Esta sección debe de escribir claramente cuál es la finalidad de la sesión de trabajo",
  "",
  "## Descripción :",
  "// Esta sección debe de describir el paso a paso o la situación sobre la cual se va a cumplir el objetivo. Si es una tarea, los pasos detallados de cómo se tiene que ejecutar; si es una investigación, si hay o no fuentes o estructuras que se tienen que seguir; si es un análisis de datos, la claridad de cómo se tienen que analizar e interpretar los datos",
  "",
  "## Contexto :",
  "// Información sobre la empresa, el proceso, el área o los actores involucrados. Esta sección debe dar visibilidad del entorno de uso de esta sesión de trabajo",
  "",
  "## Criterios de Aceptación :",
  "// Los resultados esperados a manera de lista, o los estándares que se deben cumplir (uso de skills, plugins, MCP). Los criterios de aceptación hacen referencia a los entregables de la tarea",
].join("\n")

const Metadata = Schema.Struct({
  brief: Schema.Struct({ boundary: Schema.Literals(["new", "cleared"]) }),
})
const decodeMetadata = Schema.decodeUnknownOption(Metadata)

export const isBrief = (message: SessionMessage.Info) =>
  message.type === "synthetic" && Option.isSome(decodeMetadata(message.metadata))

/** Which required sections `text` lacks, or carries only placeholders for, in template order. */
export function evaluate(text: string): Evaluation {
  const content = new Map<Key, boolean>()
  let active: Section | undefined
  for (const line of text.split(/\r?\n/)) {
    const section = SECTIONS.find((candidate) => candidate.label === label(line))
    if (section) {
      active = section
      if (!content.has(section.key)) content.set(section.key, false)
      continue
    }
    if (isHeading(line)) {
      active = undefined
      continue
    }
    if (active && line.trim().length > 0 && !line.trimStart().startsWith("//")) content.set(active.key, true)
  }
  const gaps = SECTIONS.flatMap((section): Gap[] => {
    const filled = content.get(section.key)
    if (filled === true) return []
    return [{ key: section.key, title: section.title, reason: filled === undefined ? "missing" : "empty" }]
  })
  return { complete: gaps.length === 0, gaps }
}

/** The guidance the model receives beside the evaluated prompt. */
export function render(evaluation: Evaluation, boundary: Boundary) {
  const cleared =
    boundary === "cleared"
      ? [
          "El usuario limpió el contexto de esta sesión (compactación manual). Si el resumen anterior ya describe con claridad una sección, considérala cubierta.",
          "",
        ]
      : []
  if (evaluation.complete)
    return [
      "Regla de BambuTechCode: evaluación del prompt inicial de la sesión de trabajo.",
      "",
      ...cleared,
      "Resultado: el prompt incluye las cuatro secciones requeridas (Objetivo, Descripción, Contexto y Criterios de Aceptación).",
      "",
      "Antes de empezar, verifica que cada sección sea suficiente para actuar. Si alguna es demasiado vaga, ambigua o contradictoria, pide al usuario la precisión necesaria indicando qué sección reforzar y por qué; de lo contrario, continúa con la tarea.",
    ].join("\n")
  return [
    "Regla de BambuTechCode: evaluación del prompt inicial de la sesión de trabajo.",
    "",
    ...cleared,
    `Resultado: ${describe(evaluation.gaps)}.`,
    "",
    "La información proporcionada es insuficiente para iniciar la sesión de trabajo. No realices la tarea ni uses herramientas todavía. Responde al usuario, en su idioma, con lo siguiente y detente:",
    "1. Indica qué secciones faltan o necesitan reforzarse y por qué son necesarias para esta sesión.",
    "2. Sugiere un prompt completo con la estructura requerida: rellena cada sección con lo que se infiere del mensaje y marca con [completar] lo que solo el usuario puede aportar.",
    "3. Ofrece dos caminos: que el usuario complete o corrija el prompt sugerido, o que responda a una entrevista breve en la que tú preguntas, una pregunta a la vez, para profundizar en el contexto y los objetivos de la sesión.",
    "Continúa con la tarea solo cuando el usuario confirme el prompt, termine la entrevista o indique expresamente que desea seguir sin completar la estructura.",
    "",
    "Estructura requerida:",
    "",
    TEMPLATE,
  ].join("\n")
}

/** The transcript row's one-line description. */
export function describe(gaps: ReadonlyArray<Gap>) {
  const missing = gaps.filter((gap) => gap.reason === "missing").map((gap) => gap.title)
  const empty = gaps.filter((gap) => gap.reason === "empty").map((gap) => gap.title)
  return [
    missing.length > 0 ? `faltan las secciones ${missing.join(", ")}` : undefined,
    empty.length > 0 ? `están vacías las secciones ${empty.join(", ")}` : undefined,
  ]
    .filter((part) => part !== undefined)
    .join("; ")
}

export interface Interface {
  /**
   * Evaluates the prompt just promoted in `sessionID` when it opens a new or cleared context, and
   * records the outcome as a synthetic message the next step sees. A no-op for subagent Sessions,
   * for any later prompt, and while `experimental.session_brief` is off.
   */
  readonly apply: (sessionID: SessionSchema.ID) => Effect.Effect<void, MessageDecodeError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionBrief") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const config = yield* Config.Service
    const store = yield* SessionStore.Service

    const apply = Effect.fn("SessionBrief.apply")(function* (sessionID: SessionSchema.ID) {
      const entries = yield* config.entries()
      if (Config.latest(entries, "experimental")?.session_brief !== true) return
      const session = yield* store.get(sessionID)
      if (!session || session.parentID) return
      const messages = yield* store.context(sessionID)
      const boundary = boundaryOf(messages)
      if (!boundary) return
      const evaluation = evaluate(
        messages.flatMap((message) => (message.type === "user" ? [message.text] : [])).join("\n\n"),
      )
      yield* bus.publish(SessionEvent.Synthetic, {
        sessionID,
        text: render(evaluation, boundary),
        description: evaluation.complete
          ? "Estructura de la sesión completa"
          : `Estructura de la sesión incompleta: ${evaluation.gaps.map((gap) => gap.title).join(", ")}`,
        metadata: { brief: { boundary, gaps: evaluation.gaps } },
      })
    })

    return Service.of({ apply })
  }),
)

/**
 * The model-visible history opens a new context when nothing has been answered in it yet. A compaction
 * the user asked for starts a cleared one; an automatic compaction continues the same work and is skipped.
 */
function boundaryOf(messages: ReadonlyArray<SessionMessage.Info>): Boundary | undefined {
  if (!messages.some((message) => message.type === "user")) return
  if (messages.some((message) => message.type === "assistant" || isBrief(message))) return
  const compaction = messages.find((message) => message.type === "compaction")
  if (!compaction) return "new"
  return compaction.reason === "manual" ? "cleared" : undefined
}

const normalize = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()

const isHeading = (line: string) => /^\s*#{1,6}(\s|$)/.test(line)

// "## Objetivo :", "**Objetivo:**" and a bare "Objetivo" all name the section.
const label = (line: string) =>
  normalize(
    line
      .replace(/^\s*#{1,6}(?=\s|$)/, "")
      .replace(/^[\s*_]+/, "")
      .replace(/[\s:*_]+$/, ""),
  )

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Bus.node, Config.node, SessionStore.node],
})
