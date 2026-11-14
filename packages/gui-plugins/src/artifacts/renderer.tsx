import { createMemo, lazy, onCleanup, Suspense } from "solid-js"
import { Command, createKeyed, MenuItem, Panel, type PanelTab, type Plugin } from "@opencode/plugin/gui"
import { onIdle } from "@opencode/plugin/gui/builtin"
import { sessionArtifacts } from "./detect"
import type Artifacts from "./index"

const TAB = "list"

/**
 * Artifacts: the pages, diagrams, documents and media the agent wrote in a session. A side tab lists them, and each
 * opens through the link handlers, so the file viewer renders it beside the conversation.
 */
const setup: Plugin.Setup<typeof Artifacts> = (ctx) => {
  const sessions = ctx.sessions
  const layout = ctx.layout
  const key = `${ctx.id}:${TAB}`
  const List = lazy(() => import("./list"))

  onCleanup(onIdle(() => void List.preload()))

  // The routed session's artifacts, for the menu, the palette and reloads. The list derives its own from its inputs.
  const current = createMemo(() => {
    const session = sessions.current()
    const screen = ctx.screen.current()

    if (!session || !screen) return []

    return sessionArtifacts(session.server.data.session.message.list(session.id), (path) => screen.file.resolve(path))
  })

  const show = () => {
    const session = sessions.current()

    if (session) layout.open(key, session, { tab: "select" })
  }

  // One tab object for every session, so a session switch never renders its trigger again.
  const tab: PanelTab = {
    id: TAB,
    get title() {
      return ctx.t("title")
    },
  }

  ctx.add(Panel, {
    id: "main",
    region: "side",
    mobile: {
      get title() {
        return ctx.t("title")
      },
      order: 30,
      kind: "menu",
      icon: "cube",
    },
    list: (input) => (input.open.includes(TAB) ? [tab] : []),
    render: (props) => (
      <Suspense>
        <List session={props.session} screen={props.screen} />
      </Suspense>
    ),
  })

  ctx.add(
    Command,
    (): Command => ({
      id: "open",
      title: ctx.t("command.open"),
      group: ctx.t("command.category.view"),
      editable: true,
      enabled: !!sessions.current(),
      run: show,
    }),
  )

  ctx.add(MenuItem, (): MenuItem | undefined => {
    const session = sessions.current()

    if (!session) return undefined
    const count = current().length

    return {
      menu: "session.panel",
      id: "open",
      title: ctx.t("title"),
      icon: "cube",
      keybind: `${ctx.id}.open`,
      opened: layout.state(key, session) !== "closed",
      description: count > 0 ? ctx.plural("menu.count", count) : undefined,
      order: 25,
      run: show,
    }
  })

  // The server watches the workspace files a tab shows, not files outside the workspace, and its event can trail the
  // tool call. Reload the loaded content of each artifact the agent changes again, so its viewer follows the agent.
  const seen = new Map<string, ReadonlyMap<string, string>>()

  createKeyed(
    () => {
      const session = sessions.current()
      const screen = ctx.screen.current()

      if (!session || !screen) return undefined

      return {
        session: session.key,
        screen,
        revisions: new Map(current().map((artifact) => [artifact.path, artifact.revision])),
      }
    },
    (state) => {
      const previous = seen.get(state.session)

      seen.set(state.session, state.revisions)
      const open = new Set(sessions.list().map((session) => session.key))
      seen.forEach((_, session) => {
        if (!open.has(session) && session !== state.session) seen.delete(session)
      })

      // A session seen for the first time only records its revisions: its viewers load the current content anyway.
      if (!previous) return

      state.revisions.forEach((revision, path) => {
        if (previous.get(path) === revision || !state.screen.file.get(path)?.loaded) return

        void state.screen.file.sync(path, { force: true, silent: true })
      })
    },
    {
      equals: (previous, next) =>
        previous.session === next.session &&
        previous.screen === next.screen &&
        previous.revisions.size === next.revisions.size &&
        [...next.revisions].every(([path, revision]) => previous.revisions.get(path) === revision),
    },
  )
}

export default setup
