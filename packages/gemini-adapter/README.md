# @headless-coder-sdk/gemini-adapter

Google Gemini CLI adapter for the Headless Coder SDK. It shells out to the Gemini binary in headless mode and exposes the same `ThreadHandle` contract used by the other providers.

## Installation

```bash
npm install @headless-coder-sdk/core @headless-coder-sdk/gemini-adapter
```

You will also need the Gemini CLI installed somewhere on your PATH (or pass `geminiBinaryPath` when starting the adapter).

## Usage

```ts
import { registerAdapter, createCoder } from '@headless-coder-sdk/core';
import { CODER_NAME as GEMINI, createAdapter } from '@headless-coder-sdk/gemini-adapter';

registerAdapter(GEMINI, createAdapter);
const coder = createCoder(GEMINI, { includeDirectories: [process.cwd()] });

const thread = await coder.startThread();
const result = await thread.run('List the areas of the repo that need more tests.');
console.log(result.text);
```

> Note: resume support depends on the Gemini CLI version—check the package README or upstream release notes for the latest status.
