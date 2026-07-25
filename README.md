# opencode-herdr

OpenCode plugin for [herdr](https://github.com/nicholasgasior/herdr) — auto-split panes for subagent visibility.

When the OpenCode orchestrator delegates to a subagent (via the Task tool), this plugin automatically splits a new herdr pane and runs `opencode attach` inside it, giving you a live TUI view of each subagent's work. Panes close automatically when subagents complete.

## Requirements

- OpenCode ≥ 1.0
- herdr installed and running
- OpenCode started with `--port` flag (required for `opencode attach`)

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

**Note:** OpenCode must be started with `--port 0` (or any port) for `opencode attach` to work. Without this, the plugin will emit a one-time warning and skip all splits.

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

本 fork 基于上游 `gustavocaiano/opencode-herdr` 的 `main` 分支 `f074b6c`，包含两个代码改动提交（不含本文档提交）：

| Commit | 说明 |
|--------|------|
| `1db76b3` | 基线鲁棒性修复：通过 `HERDR_BIN_PATH` / `which` 解析 `herdr` 二进制路径；将 `runInPane` 改为 `spawnSync` + 显式 `argv` 数组；将 `splitPane` 改为同步实现。 |
| `6d02524` | `serverUrl` 解析加固：优先使用 opencode 插件上下文注入的 `serverUrl`；当注入端口为空或为 `"0"` 时跳过该值，继续使用环境变量和 `lsof` 兜底。 |

### `serverUrl` 解析顺序

| 顺序 | 来源 | 处理规则 |
|------|------|----------|
| 1 | 插件上下文注入的 `serverUrl` | 端口必须存在且不能是 `"0"`；通过 `normalizeUrl()` 规范化后用于 `opencode attach`。 |
| 2 | `OPENCODE_SERVER_URL` 环境变量 | 注入值不可用时使用；同样经过 `normalizeUrl()` 处理。 |
| 3 | `lsof` 发现的监听端口 | 作为兼容旧行为的兜底路径。 |
| 4 | `null` | 找不到可用地址时输出一次警告并禁用分屏，行为与旧版一致。 |

`normalizeUrl()` 会将 `0.0.0.0` 和 `[::]` 归一为 `localhost`，并移除末尾斜杠。

### 使用方式变化

旧版依赖 `OPENCODE_SERVER_URL` 或 `lsof` 推断 opencode server 地址。解析失败时，用户通常需要用固定 `--port` 启动，例如 `--port 4096`。多开 opencode 实例时，固定端口会引发冲突。

本 fork 优先读取 opencode 插件上下文注入的 `serverUrl`。常规使用不再要求固定 `--port`，多开实例可使用各自的实际监听端口，减少端口冲突。

`serverUrl` 加固提交（`6d02524`）不改事件监听、网格布局和 `autoClose` 逻辑。基线提交（`1db76b3`）另包含 opencode 事件 payload 形状的兼容调整（`e.data` → `e.properties`）与构建配置调整（关闭 dts 声明文件生成）。最坏情况下退回旧版路径：环境变量、`lsof`，最后禁用分屏并输出警告。

### E2E 验证

本机手工 E2E 验证环境：`herdr v0.7.5`、`opencode 1.18.5`、macOS。

| 启动方式 | 结果 |
|----------|------|
| 不带 `--port` | 自动分屏成功 |
| `--port 0` | 自动分屏成功 |
| 固定 `--port` | 自动分屏成功 |

结论：三种启动方式下，子代理创建后均可自动分屏并运行 `opencode attach`。

### 已知边界

- `opencode --port 0` 随机绑定模式下，插件上下文注入值的端口可能是字符串 `"0"`。本 fork 会跳过该值，继续使用环境变量或 `lsof` 兜底。
- `opencode run` 子命令会忽略 `--port` 参数，这是 opencode 上游行为。
- 若注入的 `serverUrl` 与实际绑定端口不一致，例如 run 模式注入默认 `4096`，`opencode attach` 仍依赖该端口上有可用实例。
