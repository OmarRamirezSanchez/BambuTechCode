import path from "node:path"
import { createRadGateway } from "../src/rad-gateway"
const required = (name: string) => {
  const value = process.env[name]
  if (!value) throw Error(`${name} is required`)
  return value
}
const origin = required("RAD_CODE_ORIGIN")
const gateway = createRadGateway({
  origin,
  radOrigin: required("RAD_WEB_ORIGIN"),
  api: required("RAD_USAGE_API"),
  data: required("RAD_CODE_DATA"),
  assets: path.resolve(import.meta.dir, "../../app/dist"),
  vite: process.env.RAD_CODE_VITE,
})
gateway.server.listen(Number(new URL(origin).port || 443), "127.0.0.1", () =>
  console.log(`BambuTechCode RAD: ${origin}`),
)
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => void gateway.close().then(() => process.exit(0)))
