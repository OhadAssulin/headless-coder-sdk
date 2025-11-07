# Gemini Adapter → `CoderStreamEvent` Mapping

`packages/gemini-adapter/src/index.ts` streams JSONL lines produced by the Gemini CLI (`--output-format stream-json`). Each parsed event is converted by `normalizeGeminiEvent` into the shared `CoderStreamEvent` union. Every emitted event contains:

- `provider: 'gemini'`
- `ts`: timestamp captured during normalization
- `originalItem`: the raw JSON object from the CLI

| Gemini CLI event (`event.type`) | Condition / fields | Emitted `CoderStreamEvent` | Notes |
| --- | --- | --- | --- |
| `init` | Always | `init` with `threadId = event.session_id`, `model = event.model` | Also updates the thread handle id. |
| `message` | Always | `message` with `role = event.role ?? 'assistant'`, `text = event.content`, `delta = !!event.delta` | Gemini marks streaming chunks via `delta`. |
| `tool_use` | Always | `tool_use` with `name = event.tool_name ?? 'tool'`, `callId = event.call_id`, `args = event.args` | Mirrors Gemini tool invocation payloads. |
| `tool_result` | Always | `tool_result` with `name = event.tool_name ?? 'tool'`, `callId = event.call_id`, `result = event.result`, `exitCode = event.exit_code ?? null` | Exit codes are surfaced when Gemini shells out. |
| `error` | Always | `error` with `message = event.message ?? 'gemini error'` | Streaming should stop once this fires. |
| `result` | Always | Emits `usage` first when `event.stats` exists, followed by `done` | Signals the end of the CLI response. |
| Any other value | Default branch | `progress` with `label = String(event.type ?? 'gemini.event')` | Preserves unknown future events without dropping data. |

Because `originalItem` carries the untouched Gemini JSON, consumers can opt into CLI-specific details (e.g., token stats granularity) whenever needed.
