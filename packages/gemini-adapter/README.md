# @headless-coder-sdk/gemini-adapter

Google Gemini CLI adapter for the Headless Coder SDK. It shells out to the Gemini binary in headless mode and exposes the same `ThreadHandle` contract used by the other providers.

## Installation

```bash
npm install @headless-coder-sdk/core @headless-coder-sdk/gemini-adapter
```

You will also need the Gemini CLI installed somewhere on your PATH (or pass `geminiBinaryPath` when starting the adapter).

## Usage

```ts
import { createHeadlessGemini } from '@headless-coder-sdk/gemini-adapter';

const coder = createHeadlessGemini({
  includeDirectories: [process.cwd()],
  workingDirectory: process.cwd(),
});

const thread = await coder.startThread();
const result = await thread.run('List the areas of the repo that need more tests.');
console.log(result.text);
```

`createHeadlessGemini` registers the adapter and returns a coder, so you can instantiate it inside server code without touching the registry manually.

> Note: resume support depends on the Gemini CLI version—check the package README or upstream release notes for the latest status. The adapter shells out via Node’s `child_process`, so keep it on the server (Next.js API routes, background workers, etc.).
