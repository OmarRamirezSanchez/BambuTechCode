import { app } from "electron"

type Channel = "local" | "dev" | "beta" | "prod"

const raw = import.meta.env.OPENCODE_CHANNEL

export const CHANNEL: Channel = raw === "local" || raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

export const VERSION = app.isPackaged ? app.getVersion() : (process.env.OPENCODE_VERSION ?? app.getVersion())

const appNames: Record<Channel, string> = {
  local: "BambuTechCode Dev",
  dev: "BambuTechCode Dev",
  beta: "BambuTechCode Beta",
  prod: "BambuTechCode",
}

const appIDs: Record<Channel, string> = {
  local: "com.bambutechservices.code.dev",
  dev: "com.bambutechservices.code.dev",
  beta: "com.bambutechservices.code.beta",
  prod: "com.bambutechservices.code",
}

// Local renderer/server mode keeps the dev application identity.
export const APP_NAME = app.isPackaged ? appNames[CHANNEL] : "BambuTechCode Dev"

export const APP_ID = app.isPackaged ? appIDs[CHANNEL] : "com.bambutechservices.code.dev"
