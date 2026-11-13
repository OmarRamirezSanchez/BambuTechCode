import { Effect } from "effect"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"

export default Runtime.handler(
  Commands.commands.rad,
  Effect.fnUntraced(function* () {
    const { serveRadDesktop } = yield* Effect.promise(() => import("@opencode/server/rad-desktop"))
    return yield* Effect.tryPromise(() => serveRadDesktop())
  }),
)
