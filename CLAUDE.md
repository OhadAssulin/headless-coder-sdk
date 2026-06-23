# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a **monorepo** for the **headless-coder-sdk** - a unified TypeScript SDK that provides a consistent interface for multiple headless AI coders (Codex, Claude, Gemini). It uses **pnpm workspaces** and is published as separate npm packages under the `@headless-coder-sdk/*` scope.

The SDK standardizes threads, streaming, structured outputs, permissions, and sandboxing across different AI coder backends, allowing seamless switching with a single line of code.

## Build & Development Commands

**Install dependencies:**
```bash
pnpm install
```

**Build all packages:**
```bash
pnpm build
# Internally runs: node ./scripts/run-workspaces.mjs build
```

**Lint:**
```bash
pnpm lint
```

**Test all packages:**
```bash
pnpm test
# Internally runs: node ./scripts/run-workspaces.mjs test
```

**Run smoke tests:**
```bash
pnpm smoke
# Set HEADLESS_CODER_KEEP_SMOKE_TMP=1 to keep temp project for inspection
```

**Work with specific packages:**
```bash
# Build a single package
pnpm --filter @headless-coder-sdk/core build
```

**Run examples:**
```bash
pnpm --filter @headless-coder-sdk/examples-tests test
```

## Architecture

### Core Design Pattern

The SDK uses an **adapter pattern** with a **central registry** to provide unified access to different AI coder backends:

1. **`@headless-coder-sdk/core`** - Defines shared types (`HeadlessCoder`, `ThreadHandle`, `CoderStreamEvent`) and the adapter registry (`factory.ts`)
2. **Adapter packages** - Each adapter (codex, claude, gemini) implements the `HeadlessCoder` interface and exports:
   - `CODER_NAME` - unique provider identifier constant
   - `createAdapter()` - factory function with `coderName` property for auto-registration
   - `createHeadless*()` - convenience helper that registers and returns coder in one call

### Key Interfaces (packages/core/src/types.ts)

- **`HeadlessCoder`** - Main interface with `startThread()`, `resumeThread()`, `getThreadId()`, `close()`
- **`ThreadHandle`** - Returned by startThread/resumeThread, has `run()` and `runStreamed()` methods
- **`CoderStreamEvent`** - Unified event types: `init`, `message`, `tool_use`, `tool_result`, `progress`, `permission`, `file_change`, `plan_update`, `usage`, `error`, `cancelled`, `done`
- **`RunResult`** - Contains `threadId`, `text`, `json`, `usage`, `raw`

### Registry Pattern (packages/core/src/factory.ts)

Adapters register themselves via `registerAdapter(factory)` which reads the factory's `coderName` property. Users then call `createCoder(CODER_NAME, opts)` to instantiate.

### Workspace Structure

```
packages/
├── core/              # Shared types, factory, registry
├── codex-adapter/     # OpenAI Codex SDK wrapper (server-only, Node.js)
├── claude-adapter/    # Anthropic Claude Agent SDK wrapper
├── gemini-adapter/    # Google Gemini CLI wrapper
└── examples/          # Example scripts demonstrating runtime wiring
```

### Server-Only Adapters

**Important:** The Codex adapter (and other CLI-based adapters) must run in Node.js environments. They cannot run in browser/client contexts. In frameworks like Next.js:
- Use lazy imports in server components/API routes: `const { createHeadlessCodex } = await import('@headless-coder-sdk/codex-adapter')`
- Routes should export `runtime = 'nodejs'`
- Gate with `if (typeof window !== 'undefined')` checks

### Stream Event Mapping

Each adapter normalizes provider-specific events into the unified `CoderStreamEvent` schema. The `originalItem` field always preserves the raw provider event for debugging.

Adapters must emit at minimum: `init` → `message` → `done`

### Cancellation & Interrupts

All adapters support cooperative cancellation:
- `RunOpts.signal` (AbortSignal) for individual runs
- `thread.interrupt(reason?)` for thread-level cancellation
- Aborted runs throw `AbortError` with `code: 'interrupted'`
- Streams emit a `cancelled` event before ending

## Package Build Configuration

Each publishable package uses **tsup** for dual ESM/CJS builds:
- Entry points at `dist/*.js` (ESM) and `dist/*.cjs` (CJS)
- Type definitions at `dist/*.d.ts`
- Exports defined via `package.json` "exports" field for proper resolution
- All packages emit flattened entry points (no deep `dist/*/src` paths)

## Testing

- **Unit tests:** Verify provider event mapping to `CoderStreamEvent`
- **Integration tests:** Test `init → message → done` sequences
- **Smoke tests:** Build, pack tarballs, install in throwaway project, exercise both ESM/CJS

Test files use Node.js test runner (`tsx --test`) and are located in `test/*.test.ts` within adapter packages.

## Creating Custom Adapters

See `docs/create-your-own-adapter.md` for detailed guide. Key requirements:
1. Export `CODER_NAME` constant and `createAdapter()` function
2. Assign `createAdapter.coderName = CODER_NAME`
3. Implement `HeadlessCoder` interface
4. Map provider events to unified `CoderStreamEvent` types
5. Support cancellation via AbortSignal
6. Preserve raw events in `originalItem` field

## Distribution Notes

- Helper factories (`createHeadlessCodex/Claude/Gemini`) register adapters and return coders in one call
- `package.json` exposed via exports map for runtime version inspection
- Server-only adapters use direct SDK calls with AbortSignal-based cancellation (no worker assets needed)
