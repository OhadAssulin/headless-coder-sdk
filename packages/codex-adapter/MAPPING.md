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
| `item.started` or `item.completed` | `item.type === 'agent_message'` | `message` with `role: 'assistant'`, `text = item.text`, `delta = true` when `item.started`, omitted otherwise | Complements the delta events for full assistant messages. |
| `item.started` or `item.completed` | `item.type === 'reasoning'` | `progress` with `label = 'reasoning'` and `detail = item.text` | Surface Codex reasoning traces. |
| `item.started` | `item.type === 'command_execution'` | `tool_use` with `name: 'command'`, `callId = item.id`, `args = { command: item.command }` | Signals shell/tool invocation start. |
| `item.completed` | `item.type === 'command_execution'` | `tool_result` with `name: 'command'`, `callId = item.id`, `result = item.aggregated_output ?? item.text`, `exitCode = item.exit_code ?? null` | Emits the captured stdout/stderr when the command completes. |
| `item.*` | `item.type === 'file_change'` | `file_change` with `path = item.path`, `op = item.op`, `patch = item.patch` | Mirrors Codex file diffs, including rename metadata. |
| `item.*` | `item.type === 'plan_update'` | `plan_update` with `text = item.text` | Allows UIs to render plan steps as Codex updates them. |
| `item.*` | Any other `item.type` | `progress` with `label = item.type ?? 'item'`, `detail = item.text ?? ''` | Catch‑all for unhandled item categories. |
| `turn.completed` | Always | First `usage` (`stats = event.usage`) when usage is present, followed by `done` | Guarantees a `done` event per Codex turn. |
| `error` | Always | `error` with `message = event.message ?? 'codex error'` | Consumers should stop streaming once this arrives. |
| Any other event type | Default branch | `progress` with `label = event.type ?? 'codex.event'` | Ensures forward compatibility with future Codex events. |

Additional behavior:

- `file_change` and `plan_update` are emitted even when Codex delivers them through `item.started`/`item.completed`.
- Every branch retains the original Codex payload via `originalItem` so consumers can inspect raw fields when needed.
