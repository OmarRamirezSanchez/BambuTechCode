import { Schema } from "effect"
import { Ipc } from "@opencode/plugin/gui"

/** The most one page for the system browser carries; a larger artifact stays in the file view. */
export const MAX_PAGE_BYTES = 32 * 1024 * 1024

const Name = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255))

/**
 * Opens an artifact in the system's default browser. The browser cannot read files through the app's server, so the
 * window builds a page and main writes it to a private temporary folder, then opens its entry file.
 */
export const SystemBrowser = Ipc.define({
  id: "file.browser",
  methods: {
    /** Writes the page's files and opens `entry`, the name of one of them. Rejects when either fails. */
    open: {
      input: Schema.Struct({
        entry: Name,
        files: Schema.Array(
          Schema.Struct({ name: Name, data: Schema.Uint8ArrayFromBase64.check(Schema.isMaxLength(MAX_PAGE_BYTES)) }),
        ),
      }),
    },
  },
})
