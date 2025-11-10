# @headless-coder-sdk/claude-adapter

Anthropic Claude adapter for the Headless Coder SDK. It wraps `@anthropic-ai/claude-agent-sdk` behind the unified `createCoder`/`ThreadHandle` interface so you can swap providers without touching the rest of your agent logic.

## Installation

```bash
npm install @headless-coder-sdk/core @headless-coder-sdk/claude-adapter @anthropic-ai/claude-agent-sdk
```

## Usage

```ts
import { registerAdapter, createCoder } from '@headless-coder-sdk/core';
import { CODER_NAME as CLAUDE, createAdapter } from '@headless-coder-sdk/claude-adapter';

registerAdapter(CLAUDE, createAdapter);
const coder = createCoder(CLAUDE, { permissionMode: 'bypassPermissions' });

const thread = await coder.startThread({ workingDirectory: process.cwd() });
const result = await thread.run('Summarise the feature flag rollout plan.');
console.log(result.text);
```

> Heads up: the Anthropic SDK requires Node 18+. Make sure the `CLAUDE_API_KEY` environment variable is available before running the adapter.
