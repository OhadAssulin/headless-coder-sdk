# OpenCode Adapter Plan

Verified on 2026-06-23 against:

- OpenCode docs: https://opencode.ai/docs/sdk/
- OpenCode server docs: https://opencode.ai/docs/server/
- OpenCode CLI docs: https://opencode.ai/docs/cli/
- OpenCode config docs: https://opencode.ai/docs/config/
- OpenCode tools docs: https://opencode.ai/docs/tools/
- npm packages: `@opencode-ai/sdk@1.17.9` and `opencode-ai@1.17.9`

## Recommendation

Add a direct `@headless-coder-sdk/opencode-adapter` package instead of replacing the removed protocol server with another server bridge.

The best fit is the OpenCode server SDK path:

1. Use `createOpencode()` when the adapter should own a local OpenCode server lifecycle.
2. Use `createOpencodeClient({ baseUrl })` when callers provide an existing `opencode serve` instance.
3. Use `opencode run --format json` only as a fallback path for simple one-shot runs, not as the primary adapter.

The SDK path matches our current adapter model better because it exposes sessions, message prompts, async prompting, session aborts, message history, typed server-sent events, config, MCP status, tool metadata, and file/project APIs.

For implementation, prefer the exported `@opencode-ai/sdk/v2` surface if structured output needs to work on day one. The default documented client is simpler, but the packed v1 generated types do not include the documented `format` field. The shipped v2 types do expose `format?: OutputFormat` on prompt input and richer message/event shapes.

## Package Shape

Create a new workspace package:

```text
packages/opencode-adapter/
├── package.json
├── tsup.config.ts
├── src/index.ts
└── test/stream-events.test.ts
```

Exports should mirror the other adapters:

- `OPENCODE_CODER_NAME = "opencode"`
- `createAdapter()`
- `createHeadlessOpenCode()`
- `DEFAULT_MODEL` only if we want an SDK-level default; otherwise let OpenCode resolve the configured model.

Dependencies:

- runtime dependency or peer dependency: `@opencode-ai/sdk`
- optional peer/runtime dependency for CLI fallback: `opencode-ai`
- peer dependency: `@headless-coder-sdk/core`

## Option Mapping

Use existing `StartOpts` first and add OpenCode-specific passthrough under `providerOptions.opencode`.

Suggested supported options:

- `model`: accept OpenCode's `provider/model` format. Split into `{ providerID, modelID }` for `client.session.prompt()`.
- `workingDirectory`: pass as SDK request `query.directory`; for owned servers also pass the client `directory` option.
- `systemPrompt`: map to `body.system`.
- `allowedTools`: map to OpenCode prompt `body.tools` where possible.
- `permissionMode`: map to OpenCode config `permission` or CLI `--dangerously-skip-permissions` for CLI fallback.
- `outputSchema`: map to v2 `body.format = { type: "json_schema", schema, retryCount }`. The docs show this field on the default client, but the packed v1 types do not expose it.
- `signal` and `thread.interrupt()`: call `client.session.abort(...)` and emit/throw the same interrupted shape used by the other adapters.

Suggested `providerOptions.opencode` fields:

- `baseUrl`
- `hostname`
- `port`
- `timeout`
- `config`
- `clientConfig`
- `agent`
- `tools`
- `messageIdFactory`
- `useAsyncPrompt`
- `cliPath`
- `cliArgs`

## Runtime Flow

`startThread(opts)`:

1. Ensure an SDK client exists.
2. Call `client.session.create({ body: { title }, query: { directory } })`.
3. Return a `ThreadHandle` keyed by the OpenCode session id.

Keep a small local helper for session paths because the documented default client uses `path: { id }`, while the packaged v2 generated types use `path: { sessionID }`.

`resumeThread(id)`:

1. Optionally validate with `client.session.get({ path: { id }, query: { directory } })`.
2. Return a `ThreadHandle` using the supplied session id.

`run(input, opts)`:

1. Convert `PromptInput` to OpenCode `parts`.
2. Call `client.session.prompt({ path, query: { directory }, body })`.
3. Combine returned text parts into `RunResult.text`.
4. Map `AssistantMessage.tokens` and `cost` into `RunResult.usage` and `RunResult.raw`.

`runStreamed(input, opts)`:

1. Subscribe with `client.event.subscribe()`.
2. Filter events to the active `sessionID`.
3. Start the prompt with `client.session.promptAsync()` or run `client.session.prompt()` while consuming events.
4. Yield normalized `CoderStreamEvent` values until `session.idle`, `message.updated` completion, `session.error`, abort, or request completion.

## Event Mapping

Initial event mapping should be fixture-driven from `@opencode-ai/sdk@1.17.9` generated event types:

- `server.connected` -> `init`
- `message.part.updated` with text part -> `message`
- `message.part.updated` with reasoning part -> `progress`
- `message.part.updated` with tool part -> `tool_use` or `tool_result` depending on tool state
- `permission.updated` -> `permission`
- `file.edited`, `session.diff`, patch parts -> `file_change`
- `todo.updated` -> `plan_update`
- `command.executed` -> `progress` or `tool_use`
- `session.error` and assistant message errors -> `error`
- `session.idle` or completed prompt result -> `done`

Always preserve the raw OpenCode event on `originalItem`.

## Prompt Parts

OpenCode prompt input accepts:

- `TextPartInput`
- `FilePartInput`
- `AgentPartInput`
- `SubtaskPartInput`

Map existing SDK prompt parts conservatively:

- string input -> one `text` part
- text content part -> `text`
- local image/file content part -> `file` only when it can be represented as a URL accepted by OpenCode; otherwise throw a clear unsupported-input error

## Testing

Add three test layers:

1. Unit tests for prompt conversion and model splitting.
2. Unit tests for event normalization using saved OpenCode SSE fixtures.
3. Live tests gated behind `OPENCODE_LIVE=1`, with skips when `opencode-ai` or credentials are unavailable.

The normal workspace `build`, `test`, and `smoke` commands should pass without requiring OpenCode live credentials.

## Open Questions Before Implementation

- Whether `@opencode-ai/sdk/v2` should be treated as the primary import despite the docs still showing the default client path.
- Whether the adapter should default to launching a managed server or require `baseUrl` for production use.
- How much of OpenCode's dynamic MCP configuration should be exposed directly versus left to `opencode.json`.
