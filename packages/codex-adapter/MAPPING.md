# Codex Adapter → `CoderStreamEvent` Mapping

`packages/codex-adapter/src/index.ts` exposes `normalizeCodexEvent`, which translates every Codex streaming payload into the shared `CoderStreamEvent` union. The table below shows the full mapping. Unless otherwise noted, every emitted event includes:

- `provider: 'codex'`
- `ts`: captured from `Date.now()` at normalization time
- `originalItem`: the verbatim Codex SDK event

| Codex source event | Condition / fields | Emitted `CoderStreamEvent` | Notes |
| --- | --- | --- | --- |
| `thread.started` | Always | `init` with `threadId = event.thread_id` | Fires once per Codex thread. |
| `turn.started` | Always | `progress` with `label = 'turn.started'` | Useful for UI spinners. |
| `permission.*` | Any event whose type starts with `permission.` | `permission` with `request = event.permission ?? event.request`, `decision = 'granted'` if the type ends with `.granted`, `'denied'` if it ends with `.denied`, else undefined | Mirrors Codex permission prompts and responses. |
| `item.delta` | `event.item.type === 'agent_message'` | `message` with `role: 'assistant'`, `text = event.delta ?? event.item.text`, `delta: true` | Represents streaming assistant deltas. |
| `item.delta` | Any other `item.type` | `progress` with `label = 'item.delta:<item.type>'` and `detail = event.delta` when it is a string | Provides visibility into future/unknown delta types. |
| `item.started` / `item.updated` / `item.completed` | `item.type === 'agent_message'` | `message` with `role: 'assistant'`, `text = item.text`, `delta = true` until completion | Complements the delta events for full assistant messages. |
| `item.started` / `item.updated` / `item.completed` | `item.type === 'reasoning'` | `progress` with `label = 'reasoning'` and `detail = item.text` | Surface Codex reasoning traces. |
| `item.started` | `item.type === 'command_execution'` | `tool_use` with `name: 'command'`, `callId = item.id`, `args = { command: item.command }` | Signals shell/tool invocation start. |
| `item.updated` | `item.type === 'command_execution'` | `progress` with `label = 'command_execution'`, `detail = item.aggregated_output` | Streams aggregate command output while the command runs. |
| `item.completed` | `item.type === 'command_execution'` | `tool_result` with `name: 'command'`, `callId = item.id`, `result = item.aggregated_output ?? item.text`, `exitCode = item.exit_code ?? null` | Emits the captured stdout/stderr when the command completes. |
| `item.started` / `item.updated` | `item.type === 'mcp_tool_call'` | `tool_use` with `name = server.tool`, `callId = item.id`, `args = item.arguments` | Signals MCP tool invocation start or update. |
| `item.completed` | `item.type === 'mcp_tool_call'` | `tool_result` with `name = server.tool`, `callId = item.id`, `result = item.result`, `error = item.error` | Emits MCP tool results without requiring consumers to inspect raw events. |
| `item.*` | `item.type === 'file_change'` | `file_change` for each changed path when `item.changes` is present, otherwise a single `file_change` | Mirrors Codex file diffs. |
| `item.*` | `item.type === 'todo_list'` | `plan_update` with checkbox-formatted todo text | Allows UIs to render current Codex todo state. |
| `item.*` | `item.type === 'web_search'` | `progress` with `label = 'web_search'`, `detail = item.query` | Surfaces live or cached search activity. |
| `item.*` | `item.type === 'error'` | `error` with `message = item.message ?? 'codex item error'` | Surfaces non-fatal item errors. |
| `item.*` | Any other `item.type` | `progress` with `label = item.type ?? 'item'`, `detail = item.text ?? ''` | Catch‑all for unhandled item categories. |
| `turn.completed` | Always | First `usage` (`stats = event.usage`) when usage is present, followed by `done` | Guarantees a `done` event per Codex turn. |
| `turn.failed` | Always | `error` with `code = 'turn.failed'` and Codex error message | Consumers should stop streaming once this arrives. |
| `error` | Always | `error` with `message = event.message ?? 'codex error'` | Consumers should stop streaming once this arrives. |
| Any other event type | Default branch | `progress` with `label = event.type ?? 'codex.event'` | Ensures forward compatibility with future Codex events. |

Additional behavior:

- `file_change` and `plan_update` are emitted even when Codex delivers them through `item.started`/`item.updated`/`item.completed`.
- Every branch retains the original Codex payload via `originalItem` so consumers can inspect raw fields when needed.
