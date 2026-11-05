import { describe, expect, test } from "bun:test"
import { SessionBrief } from "@opencode/core/session/brief"

const complete = [
  "## Objetivo :",
  "Automatizar el reporte mensual de ventas.",
  "",
  "## Descripción :",
  "1. Extraer las ventas del ERP.",
  "2. Publicar el tablero.",
  "",
  "## Contexto :",
  "Área comercial de Bambú; lo consulta la dirección cada mes.",
  "",
  "## Criterios de Aceptación :",
  "- Tablero publicado",
  "- Cifras validadas contra el ERP",
].join("\n")

describe("SessionBrief.evaluate", () => {
  test("accepts a prompt with every section filled", () => {
    expect(SessionBrief.evaluate(complete)).toEqual({ complete: true, gaps: [] })
  })

  test("reports missing sections in template order", () => {
    expect(SessionBrief.evaluate("## Contexto :\nÁrea comercial.\n\n## Objetivo :\nVender más.").gaps).toEqual([
      { key: "descripcion", title: "Descripción", reason: "missing" },
      { key: "criterios", title: "Criterios de Aceptación", reason: "missing" },
    ])
  })

  test("treats template placeholders and blank lines as empty", () => {
    expect(SessionBrief.evaluate(SessionBrief.TEMPLATE).gaps.map((gap) => gap.reason)).toEqual([
      "empty",
      "empty",
      "empty",
      "empty",
    ])
    expect(SessionBrief.evaluate("## Objetivo :\n\n   \n## Descripción :\nPasos").gaps).toMatchObject([
      { key: "objetivo", reason: "empty" },
      { key: "contexto", reason: "missing" },
      { key: "criterios", reason: "missing" },
    ])
  })

  test("matches headings without accents, with other levels, bold labels, or no marker", () => {
    const text = [
      "# OBJETIVO",
      "Vender más.",
      "**Descripcion:**",
      "Pasos.",
      "Contexto",
      "Área comercial.",
      "### Criterios de aceptacion :",
      "- Entregable",
    ].join("\n")
    expect(SessionBrief.evaluate(text)).toEqual({ complete: true, gaps: [] })
  })

  test("ends a section at the next heading of any kind", () => {
    const text = ["## Objetivo :", "## Notas", "Esto no pertenece al objetivo.", "## Descripción :", "Pasos."].join(
      "\n",
    )
    expect(SessionBrief.evaluate(text).gaps).toMatchObject([
      { key: "objetivo", reason: "empty" },
      { key: "contexto", reason: "missing" },
      { key: "criterios", reason: "missing" },
    ])
  })

  test("finds no section in free text", () => {
    expect(SessionBrief.evaluate("Hazme un reporte de ventas para mañana").gaps.map((gap) => gap.key)).toEqual([
      "objetivo",
      "descripcion",
      "contexto",
      "criterios",
    ])
  })
})

describe("SessionBrief.render", () => {
  test("tells the model to proceed when the structure is complete", () => {
    const text = SessionBrief.render({ complete: true, gaps: [] }, "new")
    expect(text).toContain("incluye las cuatro secciones requeridas")
    expect(text).not.toContain(SessionBrief.TEMPLATE)
    expect(text).not.toContain("limpió el contexto")
  })

  test("names the gaps, asks for a prompt or an interview, and includes the template", () => {
    const evaluation = SessionBrief.evaluate("## Objetivo :\n\n## Contexto :\nÁrea comercial.")
    const text = SessionBrief.render(evaluation, "cleared")
    expect(text).toContain(
      "faltan las secciones Descripción, Criterios de Aceptación; están vacías las secciones Objetivo",
    )
    expect(text).toContain("No realices la tarea ni uses herramientas todavía")
    expect(text).toContain("Sugiere un prompt completo")
    expect(text).toContain("entrevista breve")
    expect(text).toContain("limpió el contexto")
    expect(text).toContain(SessionBrief.TEMPLATE)
  })
})
