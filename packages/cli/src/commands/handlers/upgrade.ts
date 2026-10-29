import { Effect } from "effect"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"

export default Runtime.handler(Commands.commands.upgrade, () =>
  Effect.fail(
    new Error(
      "BambuTechCode updates are managed from https://github.com/OmarRamirezSanchez/BambuTechCode. Update the fork and rebuild; a Bambu release feed is not available yet.",
    ),
  ),
)
