# @headless-coder-sdk/codex-adapter

Adapter that bridges the OpenAI Codex CLI/SDK into the Headless Coder SDK interface.

## Installation

```bash
npm install @headless-coder-sdk/core @headless-coder-sdk/codex-adapter
```

## Usage

```ts
import { registerAdapter, createCoder } from '@headless-coder-sdk/core';
import { CODER_NAME as CODEX, createAdapter } from '@headless-coder-sdk/codex-adapter';

registerAdapter(CODEX, createAdapter);
const coder = createCoder(CODEX, { workingDirectory: process.cwd() });
const thread = await coder.startThread();
const turn = await thread.run('Write unit tests for the git helper.');
console.log(turn.text);
```

## Worker placement

- The adapter forks a worker via `fileURLToPath(new URL('./worker.js', import.meta.url))`.
- A transpiled `dist/worker.js` **must remain adjacent** to the published entry file. If you bundle the adapter, copy the worker into the final output directory or configure your bundler to emit it as an asset.
- When packaging custom builds (Electron, webpack, etc.), keep the relative path stable or provide your own thin wrapper that adjusts `WORKER_PATH` before registering the adapter.

The published package already includes the worker alongside the JS/typings outputs; the guidance above is to prevent third-party bundlers from tree-shaking or relocating it.
