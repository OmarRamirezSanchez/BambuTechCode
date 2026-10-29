import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

describe("upgrade command", () => {
  test("is registered in root help and documents its options", async () => {
    const root = await cli(["--help"], {}, "../src/index.ts")
    const help = await cli(["upgrade", "--help"], {}, "../src/index.ts")
    expect(root.exitCode).toBe(0)
    expect(root.stdout).toContain("upgrade")
    expect(help.exitCode).toBe(0)
    expect(help.stdout).toContain("[<target>]")
    expect(help.stdout).toContain("--method")
    expect(help.stdout).toContain("-m")
  })

  test.each([
    { label: "automatic method detection", args: [] },
    { label: "an explicit method", args: ["--method", "pnpm"] },
    { label: "an explicit target", args: ["2.0.0", "-m", "bun"] },
  ])("keeps the Bambu fork intact with $label", async ({ args }) => {
    const result = await cli(args)
    expect(result.exitCode).not.toBe(0)
    expect(result.events).toEqual([])
    expect(result.stdout + result.stderr).toContain("github.com/OmarRamirezSanchez/BambuTechCode")
    expect(result.stdout + result.stderr).toContain("Update the fork and rebuild")
  })

  test("rejects unsupported methods before attempting an upgrade", async () => {
    const result = await cli(["--method", "apt"])
    expect(result.exitCode).not.toBe(0)
    expect(result.events).toEqual([])
  })
})

async function cli(args: readonly string[], env: Record<string, string> = {}, entry = "fixture/upgrade.ts") {
  const root = await mkdtemp(path.join(os.tmpdir(), "opencode-upgrade-"))
  try {
    const child = Bun.spawn(
      [process.execPath, "--define", 'OPENCODE_VERSION="0.0.0-beta-old"', path.join(import.meta.dir, entry), ...args],
      {
        cwd: path.join(import.meta.dir, ".."),
        env: {
          ...process.env,
          OPENCODE_TEST_HOME: root,
          XDG_DATA_HOME: path.join(root, "data"),
          XDG_CONFIG_HOME: path.join(root, "config"),
          XDG_CACHE_HOME: path.join(root, "cache"),
          XDG_STATE_HOME: path.join(root, "state"),
          OPENCODE_DISABLE_AUTOUPDATE: "1",
          ...env,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    const events = stdout
      .split("\n")
      .filter((line) => line.startsWith("EVENT "))
      .map((line) => JSON.parse(line.slice(6)))
    expect(await Bun.file(path.join(root, "state", "opencode", "service-local.json")).exists()).toBe(false)
    return { stdout, stderr, exitCode, events }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
