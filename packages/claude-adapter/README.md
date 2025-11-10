# @headless-coder-sdk/claude-adapter

Anthropic Claude adapter for the Headless Coder SDK. It wraps `@anthropic-ai/claude-agent-sdk` behind the unified `createCoder`/`ThreadHandle` interface so you can swap providers without touching the rest of your agent logic.

## Installation

```bash
npm install @headless-coder-sdk/core @headless-coder-sdk/claude-adapter @anthropic-ai/claude-agent-sdk
```

## Usage

```ts
import { createHeadlessClaude } from '@headless-coder-sdk/claude-adapter';

const coder = createHeadlessClaude({ permissionMode: 'bypassPermissions' });

const thread = await coder.startThread({ workingDirectory: process.cwd() });
const result = await thread.run('Summarise the feature flag rollout plan.');
console.log(result.text);
```

`createHeadlessClaude` registers the adapter (if needed) and returns a coder so you can skip the manual `registerAdapter` boilerplate.

> Heads up: the Anthropic SDK requires Node 18+. Make sure the `CLAUDE_API_KEY` environment variable is available before running the adapter.
