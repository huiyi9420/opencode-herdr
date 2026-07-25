import { execSync, spawnSync } from "node:child_process";

/**
 * Resolve the absolute path to the herdr binary.
 * Bun's execSync may not inherit the full PATH, so we resolve upfront.
 */
function herdrBin(): string {
  if (process.env.HERDR_BIN_PATH) return process.env.HERDR_BIN_PATH;
  try {
    return execSync("which herdr", { encoding: "utf-8" }).trim();
  } catch {
    return "herdr";
  }
}

const HERDR = herdrBin();

/**
 * Check if we're running inside a herdr environment.
 */
export function isInHerdr(): boolean {
  return process.env.HERDR_ENV === "1";
}

/**
 * Get the current pane ID.
 * First checks HERDR_PANE_ID env var, then falls back to `herdr pane list --json`.
 */
export async function getCurrentPaneId($: any): Promise<string | null> {
  if (process.env.HERDR_PANE_ID) {
    return process.env.HERDR_PANE_ID;
  }

  try {
    const result = await $`${HERDR} pane list --json`.quiet().nothrow();
    const text = result.text?.() ?? result.stdout?.toString() ?? String(result);
    if (!text) return null;

    const parsed = JSON.parse(text);
    const focused = parsed?.panes?.find((p: any) => p.focused === true);
    return focused?.pane_id ?? null;
  } catch {
    return null;
  }
}

/**
 * Split a pane in the given direction and return the new pane ID.
 */
export function splitPane(direction: "right" | "down", fromPaneId: string): string | null {
  try {
    const output = execSync(
      `${HERDR} pane split ${fromPaneId} --direction ${direction} --no-focus`,
      { encoding: "utf-8" },
    );
    const parsed = JSON.parse(output);
    return parsed?.result?.pane?.pane_id ?? null;
  } catch {
    return null;
  }
}

/**
 * Run a command in a specific pane. Fire and forget.
 *
 * Uses spawnSync with an explicit argv array so the command text is passed as
 * a single argument. Herdr's `pane run` expects the text as one argument —
 * passing multiple args causes it to treat the first word as an executable
 * and fail with ENOENT.
 */
export function runInPane(paneId: string, ...commandParts: string[]): void {
  try {
    const text = commandParts.join(" ");
    spawnSync(HERDR, ["pane", "run", paneId, text], { encoding: "utf-8" });
  } catch {
    // fire and forget
  }
}

/**
 * Close a pane. Silently ignores all errors.
 */
export function closePane(paneId: string): void {
  try {
    execSync(`${HERDR} pane close ${paneId}`, { encoding: "utf-8" });
  } catch {
    // silently swallow all errors
  }
}

// Module-level memoization for resolveServerUrl
let _resolvedServerUrl: string | null | undefined = undefined;

/**
 * Resolve the OpenCode server URL.
 * Memoized — only resolves once, then returns the cached value.
 */
export function resolveServerUrl(): string | null {
  if (_resolvedServerUrl !== undefined) {
    return _resolvedServerUrl;
  }

  // Step 1: Check env var
  const envUrl = process.env.OPENCODE_SERVER_URL;
  if (envUrl) {
    try {
      const parsed = new URL(envUrl);
      if (parsed.hostname === "0.0.0.0" || parsed.hostname === "[::]") {
        parsed.hostname = "localhost";
      }
      const url = parsed.toString().replace(/\/+$/, "");
      _resolvedServerUrl = url;
      return url;
    } catch {
      // Invalid URL, fall through
    }
  }

  // Step 2: Fall back to lsof
  try {
    const output = execSync(
      `lsof -nP -a -p ${process.pid} -iTCP -sTCP:LISTEN`,
      { encoding: "utf-8", timeout: 3000 },
    );
    const match = output.match(/:(\d+)\s+\(LISTEN\)/);
    if (match) {
      const url = `http://localhost:${match[1]}`;
      _resolvedServerUrl = url;
      return url;
    }
  } catch {
    // lsof failed, fall through
  }

  // Step 3: No URL available
  _resolvedServerUrl = null;
  console.warn(
    "opencode-herdr: Could not resolve OpenCode server URL. Splits will be disabled. Start OpenCode with --port flag.",
  );
  return null;
}
