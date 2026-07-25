# opencode-herdr

OpenCode plugin for [herdr](https://github.com/nicholasgasior/herdr) — auto-split panes for subagent visibility.

When the OpenCode orchestrator delegates to a subagent (via the Task tool), this plugin automatically splits a new herdr pane and runs `opencode attach` inside it, giving you a live TUI view of each subagent's work. Panes close automatically when subagents complete.

## Requirements

- OpenCode ≥ 1.0
- herdr installed and running
- OpenCode running with any server port mode: no `--port`, `--port 0`, or an explicit `--port`

## Installation

Add `opencode-herdr` to your `opencode.json` plugin array:

```json
{
  "plugin": [
    "opencode-herdr"
  ]
}
```

## Configuration

Create `~/.config/opencode/opencode-herdr.json` (or `$XDG_CONFIG_HOME/opencode/opencode-herdr.json`):

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `splits` | boolean | `true` | Enable/disable automatic pane splitting |
| `autoClose` | boolean | `true` | Auto-close panes when subagents go idle |
| `direction` | `"right"` \| `"down"` | `"right"` | Default split direction for the first subagent |

### Example

```json
{
  "splits": true,
  "autoClose": false,
  "direction": "right"
}
```

With `autoClose: false`, subagent panes remain open for manual inspection after completion. They still close on `session.deleted` and `session.error` events.

## Subagent Splits

When a subagent session is created, the plugin:

1. Splits a herdr pane using a grid layout strategy
2. Runs `opencode attach --session <id>` in the new pane
3. Tracks the session-to-pane mapping
4. Closes the pane when the subagent finishes (if `autoClose` is enabled)

**Note:** The plugin detects the real OpenCode server port from the current process. Splits work when OpenCode starts without `--port`, with `--port 0`, or with an explicit `--port`. If no local listener or fallback URL is available, the plugin emits a one-time warning and skips all splits.

## How It Works

| Event | Action |
|-------|--------|
| `session.created` (with `parentID`) | Split pane, run `opencode attach`, store mapping |
| `session.status` → `idle` (subagent) | Close pane (if `autoClose` enabled) |
| `session.deleted` | Close pane |
| `session.error` | Close pane |

The plugin is a complete no-op when not running inside herdr (no `HERDR_ENV=1`).

## Grid Layout

The plugin uses a row-based tiling pattern to create a readable grid instead of a single column:

```
┌──────────┬──────────┐
│ Original │ Agent 0  │  1st: split right from original
│          ├──────────┤
│          │ Agent 1  │  2nd: split down from Agent 0
├──────────┤          │
│ Agent 2  │          │  3rd: split down from original
└──────────┴──────────┘
```

4th+ agents split right from the appropriate row, cycling through rows.

## License

MIT

## 本 fork 的变更说明（Chinese）

本 fork 基于上游 `gustavocaiano/opencode-herdr` 的 `main` 分支 `f074b6c`，包含下列代码改动（不含本文档提交）：

| Commit | 说明 |
|--------|------|
| `1db76b3` | 基线鲁棒性修复：通过 `HERDR_BIN_PATH` / `which` 解析 `herdr` 二进制路径；将 `runInPane` 改为 `spawnSync` + 显式 `argv` 数组；将 `splitPane` 改为同步实现。 |
| `6d02524` | `serverUrl` 解析加固：优先使用 opencode 插件上下文注入的 `serverUrl`；当注入端口为空或为 `"0"` 时跳过该值，继续使用环境变量和 `lsof` 兜底。 |
| 当前改动 | 真实绑定端口优先：通过 `lsof` 读取当前进程的 LISTEN 端口；仅当注入端口与真实绑定端口一致时采用注入值，否则使用真实绑定端口。 |

### `serverUrl` 解析顺序

| 顺序 | 来源 | 处理规则 |
|------|------|----------|
| 1 | `lsof` 发现的当前进程监听端口 | 真实绑定优先；若注入 `serverUrl` 的端口存在、不是 `"0"`，且与真实绑定端口一致，则采用注入值；否则使用 `http://localhost:<真实端口>`。 |
| 2 | 插件上下文注入的 `serverUrl` | 仅在未发现本地监听端口时使用；端口必须存在且不能是 `"0"`；通过 `normalizeUrl()` 规范化后用于 `opencode attach`。 |
| 3 | `OPENCODE_SERVER_URL` 环境变量 | 注入值不可用时使用；同样经过 `normalizeUrl()` 处理。 |
| 4 | `null` | 找不到可用地址时输出一次警告并禁用分屏，行为与旧版一致。 |

`normalizeUrl()` 会将 `0.0.0.0` 和 `[::]` 归一为 `localhost`，并移除末尾斜杠。

### 使用方式变化

旧版依赖 `OPENCODE_SERVER_URL` 或 `lsof` 推断 opencode server 地址。解析失败时，用户通常需要用固定 `--port` 启动，例如 `--port 4096`。多开 opencode 实例时，固定端口会引发冲突。

本 fork 以当前进程的真实绑定端口为准。无 `--port`、`--port 0`、固定 `--port` 三种启动方式下，插件都能自动发现真实端口并用于 `opencode attach`。注入的 `serverUrl` 仅在端口与真实绑定一致时采用；未发现本地监听端口时，才回退到注入值和 `OPENCODE_SERVER_URL`。

`serverUrl` 加固不改事件监听、网格布局和 `autoClose` 逻辑。基线提交（`1db76b3`）另包含 opencode 事件 payload 形状的兼容调整（`e.data` → `e.properties`）与构建配置调整（关闭 dts 声明文件生成）。无本地监听端口时退回注入值、环境变量，最后禁用分屏并输出警告。

### E2E 验证

本机手工 E2E 验证环境：`herdr v0.7.5`、`opencode 1.18.5`、macOS。

| 启动方式 | 结果 |
|----------|------|
| 不带 `--port` | 自动分屏成功 |
| `--port 0` | 自动分屏成功 |
| 固定 `--port` | 自动分屏成功 |

结论：三种启动方式下，子代理创建后均可自动分屏并运行 `opencode attach`。

### 已知边界

- `opencode run` 子命令会忽略 `--port` 参数，这是 opencode 上游行为。
- 若当前进程有多个 LISTEN 端口，插件使用 `lsof` 返回的第一个端口作为启发式选择。
