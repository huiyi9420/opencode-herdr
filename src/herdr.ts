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
 * Normalize a URL for use as the OpenCode server URL.
 * Rewrites wildcard bind addresses (0.0.0.0 / [::]) to localhost and trims trailing slashes.
 * Does not mutate the input URL.
 */
function normalizeUrl(url: URL): string {
  const u = new URL(url.toString());
  if (u.hostname === "0.0.0.0" || u.hostname === "[::]") {
    u.hostname = "localhost";
  }
  return u.toString().replace(/\/+$/, "");
}

/**
 * Resolve the OpenCode server URL.
 * Memoized — only resolves once, then returns the cached value (null is cached too).
 *
 * Resolution order (real-bound-port first, fixes the case where opencode is
 * started without `--port`: it binds a random port e.g. 4747, but the injected
 * serverUrl is the default `http://localhost:4096`, causing attach to fail):
 *
 * 1. Collect every LISTEN port of this process via lsof (`bound[]`).
 *    - bound non-empty + injected URL's port ∈ bound → normalizeUrl(injected)
 *    - bound non-empty + injected missing/mismatched  → http://localhost:${bound[0]}
 * 2. bound empty (lsof unavailable / no listener, e.g. remote server):
 *    - injected URL (skipped when port is empty or "0" — known upstream bug)
 *    - OPENCODE_SERVER_URL env var
 * 3. null + warning (splits disabled)
 */
export function resolveServerUrl(injected?: URL): string | null {
  if (_resolvedServerUrl !== undefined) {
    return _resolvedServerUrl;
  }

  // Step 1: Collect every LISTEN port of this process via lsof.
  // Failures yield an empty array (never throw) — lsof may be absent or the
  // process may not be listening (remote-server scenario).
  const bound: string[] = [];
  try {
    const output = execSync(
      `lsof -nP -a -p ${process.pid} -iTCP -sTCP:LISTEN`,
      { encoding: "utf-8", timeout: 3000 },
    );
    const seen = new Set<string>();
    for (const m of output.matchAll(/:(\d+)\s+\(LISTEN\)/g)) {
      const port = m[1];
      if (port && !seen.has(port)) {
        seen.add(port);
        bound.push(port);
      }
    }
  } catch {
    // lsof unavailable or no matches → bound stays []
  }

  // Step 2: Real-bound-port takes priority over the (possibly default 4096) injected URL.
  if (bound.length > 0) {
    if (injected && injected.port && injected.port !== "0" && bound.includes(injected.port)) {
      const url = normalizeUrl(injected);
      _resolvedServerUrl = url;
      return url;
    }
    const url = `http://localhost:${bound[0]}`;
    _resolvedServerUrl = url;
    return url;
  }

  // Step 3: No local LISTEN port (remote server / lsof missing) → fall back to
  // injected URL then the env var, preserving the original behavior.
  if (injected && injected.port && injected.port !== "0") {
    const url = normalizeUrl(injected);
    _resolvedServerUrl = url;
    return url;
  }

  const envUrl = process.env.OPENCODE_SERVER_URL;
  if (envUrl) {
    try {
      const url = normalizeUrl(new URL(envUrl));
      _resolvedServerUrl = url;
      return url;
    } catch {
      // Invalid URL, fall through
    }
  }

  // Step 4: No URL available
  _resolvedServerUrl = null;
  console.warn(
    "opencode-herdr: Could not resolve OpenCode server URL. Splits will be disabled. Start OpenCode with --port flag.",
  );
  return null;
}
