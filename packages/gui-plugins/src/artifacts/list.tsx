import { createMemo, For, Show } from "solid-js"
import { FileIcon } from "@opencode/ui/file-icon"
import { Icon } from "@opencode/ui/icon"
import { getDirectory, getFilename } from "@opencode/util/path"
import { usePlugin, type MountedSession, type SessionScreen } from "@opencode/plugin/gui"
import { sessionArtifacts } from "./detect"
import type Artifacts from "./index"

/** The session's artifacts, newest first; each opens in the file viewer beside the conversation. */
export default function ArtifactList(props: { session: MountedSession; screen: SessionScreen }) {
  const ctx = usePlugin<typeof Artifacts>()

  const artifacts = createMemo(() =>
    sessionArtifacts(props.session.server.data.session.message.list(props.session.id), (path) =>
      props.screen.file.resolve(path),
    ),
  )

  // The file handler opens the exact path the agent wrote, inside the workspace or outside it.
  const open = (path: string) => ctx.links.open({ href: path, exact: true, session: props.session })

  return (
    <div data-slot="artifacts-panel" class="flex h-full min-h-0 flex-col bg-v2-background-bg-base">
      <Show
        when={artifacts().length > 0}
        fallback={
          <div class="flex flex-1 flex-col items-center justify-center gap-2 px-6 pb-40 text-center">
            <Icon name="cube" size="large" class="mb-2 text-v2-icon-icon-muted" />
            <div class="text-[13px] font-medium leading-[var(--line-height-compact)] text-v2-text-text-base">
              {ctx.t("empty.title")}
            </div>
            <div class="max-w-[282px] text-[13px] leading-[var(--line-height-base)] text-v2-text-text-muted">
              {ctx.t("empty.description")}
            </div>
          </div>
        }
      >
        <ul aria-label={ctx.t("list.label")} class="min-h-0 flex-1 overflow-y-auto p-2" data-scrollable>
          <For each={artifacts()}>
            {(artifact) => (
              <li>
                <button
                  type="button"
                  data-slot="artifacts-item"
                  data-path={artifact.path}
                  title={artifact.path}
                  class="flex h-12 w-full min-w-0 items-center gap-3 rounded-md px-2 text-start hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-v2-border-border-focus"
                  onClick={() => open(artifact.path)}
                >
                  <FileIcon node={{ path: artifact.path, type: "file" }} class="size-4 shrink-0" />
                  <span class="flex min-w-0 flex-1 flex-col">
                    <bdi class="truncate text-[13px] font-medium leading-[var(--line-height-compact)] text-v2-text-text-base">
                      {getFilename(artifact.path)}
                    </bdi>
                    <Show when={/[\\/]/.test(artifact.path)}>
                      <bdi class="truncate text-12-regular leading-[var(--line-height-compact)] text-v2-text-text-muted">
                        {getDirectory(artifact.path)}
                      </bdi>
                    </Show>
                  </span>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  )
}
