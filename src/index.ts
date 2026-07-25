import type { Plugin } from "@opencode-ai/plugin"
import { isInHerdr, getCurrentPaneId, splitPane, runInPane, closePane, resolveServerUrl } from "./herdr"
import { loadConfig } from "./config"

const plugin: Plugin = async ({ client, $ }) => {
  // Early exit if not in herdr
  if (!isInHerdr()) {
    return {
      async event() {
        // Complete no-op outside herdr
      },
    }
  }

  // Load config and resolve server URL at startup
  const config = loadConfig()
  const serverUrl = resolveServerUrl()
  const originalPaneId = await getCurrentPaneId($)

  // State
  const activeSplits = new Map<string, string>() // sessionID → paneID
  const rowFrontier: (string | undefined)[] = [undefined, undefined, undefined]
  let agentCount = 0
  let splitQueue: Promise<unknown> = Promise.resolve(undefined)

  // --- Queue: serialize all split/close operations ---
  function enqueueSplitOp<T>(fn: () => T): Promise<T> {
    const result = splitQueue.then(fn, fn)
    splitQueue = result.then(
      () => {},
      () => {},
    )
    return result as Promise<T>
  }

  // --- Grid state reset ---
  function resetGridState(): void {
    rowFrontier[0] = undefined
    rowFrontier[1] = undefined
    rowFrontier[2] = undefined
    agentCount = 0
  }

  // --- Remove and close a subagent pane ---
  function removeAndClose(sessionId: string): void {
    const paneId = activeSplits.get(sessionId)
    if (!paneId) return
    activeSplits.delete(sessionId)

    for (let i = 0; i < rowFrontier.length; i++) {
      if (rowFrontier[i] === paneId) {
        rowFrontier[i] = originalPaneId ?? undefined
      }
    }

    closePane(paneId)
    if (activeSplits.size === 0) {
      resetGridState()
    }
  }

  // --- Grid layout: determine split direction and source pane ---
  function getGridLayout(): { direction: "right" | "down"; fromPaneId: string | null } {
    const n = agentCount
    if (n === 0) {
      return { direction: config.direction, fromPaneId: originalPaneId }
    } else if (n === 1) {
      return { direction: "down", fromPaneId: rowFrontier[0] ?? null }
    } else if (n === 2) {
      return { direction: "down", fromPaneId: originalPaneId }
    } else {
      const rowIdx = (n - 3) % 3
      return { direction: "right", fromPaneId: rowFrontier[rowIdx] ?? null }
    }
  }

  // --- Update grid state after a successful split ---
  function updateGridState(paneId: string): void {
    if (agentCount < 3) {
      rowFrontier[agentCount] = paneId
    } else {
      const rowIdx = (agentCount - 3) % 3
      rowFrontier[rowIdx] = paneId
    }
    agentCount++
  }

  return {
    async event({ event }) {
      const e = event as any
      const props = e.properties ?? {}

      // --- session.created: create split for child sessions ---
      // Event shape: { type, properties: { sessionID, info: { parentID, ... } } }
      if (e.type === "session.created") {
        if (!config.splits) return
        if (!props.info?.parentID) return
        if (!serverUrl) return
        const sessionId = props.sessionID
        if (!sessionId) return
        if (activeSplits.has(sessionId)) return

        enqueueSplitOp(() => {
          if (activeSplits.has(sessionId)) return

          const { direction, fromPaneId } = getGridLayout()
          if (!fromPaneId) return

          const newPaneId = splitPane(direction, fromPaneId)
          if (!newPaneId) return

          runInPane(newPaneId, "opencode", "attach", serverUrl, "--session", sessionId)

          activeSplits.set(sessionId, newPaneId)
          updateGridState(newPaneId)
        })

        return
      }

      // --- session.status: auto-close idle subagents ---
      // Event shape: { type, properties: { sessionID, status: { type: "busy"|"idle" } } }
      if (e.type === "session.status") {
        if (!config.autoClose) return
        const sessionId = props.sessionID
        const status = props.status?.type ?? props.status
        if (status !== "idle") return

        if (sessionId && activeSplits.has(sessionId)) {
          removeAndClose(sessionId)
        }
        return
      }

      // --- session.deleted: close pane if mapped ---
      if (e.type === "session.deleted") {
        const sessionId = props.sessionID
        if (sessionId && activeSplits.has(sessionId)) {
          removeAndClose(sessionId)
        }
        return
      }

      // --- session.error: close pane if mapped ---
      if (e.type === "session.error") {
        const sessionId = props.sessionID
        if (sessionId && activeSplits.has(sessionId)) {
          removeAndClose(sessionId)
        }
        return
      }
    },
  }
}

export default plugin
