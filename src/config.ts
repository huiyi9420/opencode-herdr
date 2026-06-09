import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export type PluginConfig = {
  splits: boolean
  autoClose: boolean
  direction: "right" | "down"
}

const defaults: PluginConfig = {
  splits: true,
  autoClose: true,
  direction: "right",
}

const VALID_DIRECTIONS = new Set<string>(["right", "down"])

export function loadConfig(): PluginConfig {
  const configDir = process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, "opencode")
    : join(homedir(), ".config", "opencode")

  const configPath = join(configDir, "opencode-herdr.json")

  try {
    const raw = readFileSync(configPath, "utf-8")

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      console.warn("opencode-herdr: Invalid config file, using defaults")
      return { ...defaults }
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      console.warn("opencode-herdr: Invalid config file, using defaults")
      return { ...defaults }
    }

    const obj = parsed as Record<string, unknown>
    const config: PluginConfig = { ...defaults }

    if ("splits" in obj && typeof obj.splits === "boolean") {
      config.splits = obj.splits
    }

    if ("autoClose" in obj && typeof obj.autoClose === "boolean") {
      config.autoClose = obj.autoClose
    }

    if ("direction" in obj && typeof obj.direction === "string" && VALID_DIRECTIONS.has(obj.direction)) {
      config.direction = obj.direction as "right" | "down"
    }

    return config
  } catch {
    return { ...defaults }
  }
}
