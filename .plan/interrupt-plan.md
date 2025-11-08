# Adapter Interrupt Implementation Plan

## Goal
Implement cancellation plumbing in Codex, Claude, and Gemini adapters so that:
- `RunOpts.signal` can abort in-flight runs.
- Each `ThreadHandle` exposes `interrupt(reason?)`.
- Streamed runs emit a `cancelled` event (or `error` with `code='interrupted'`).

---

## Step-by-step

1. **Core Types**
   - Add `signal?: AbortSignal` to `RunOpts`.
   - Extend `ThreadHandle` with `interrupt?(reason?: string)`.
   - Add `cancelled` to `CoderStreamEvent`.

2. **Codex Adapter**
   - Track per-thread state: underlying Codex thread + current AbortController.
   - When `run`/`runStreamed` starts, create an AbortController and hook `opts.signal` (if provided).
   - On abort/interrupt, call Codex’s underlying abort capability (if available) or stop consuming the iterator; reject `run()` with `AbortError` (`code='interrupted'`).
   - Streamed runs: stop iteration, emit `{ type: 'cancelled', provider: 'codex', ts: now() }` before exiting.

3. **Claude Adapter**
   - Maintain AbortController per run; pass its signal to the Claude Agent SDK if supported.
   - Break out of the async generator when the signal fires; emit `cancelled`.
   - Implement `interrupt()` to abort the controller.

4. **Gemini Adapter**
   - For non-streaming runs: hold onto the spawned child process; on abort, send `proc.kill()` and reject with `AbortError`.
   - For streaming runs: kill the process, close readers, and emit `cancelled`.
   - Ensure temporary files/streams are cleaned up even on cancellation.

5. **Thread Interrupt Wiring**
   - Each adapter’s `createThreadHandle` stores state and exposes `interrupt()` that aborts the active controller.
   - Guard against multiple overlapping runs (interrupt should no-op if nothing is running).

6. **Docs & README**
   - Document the new `signal` option and `thread.interrupt()` helper.
   - Provide a short sample showing cancellation usage.

7. **Testing**
   - Add or update example tests to cover cancellation (if feasible) or manually validate by triggering `AbortController` in a sample script.

8. **Follow-up**
   - Consider exposing a `cancelled` reason for analytics/logging.
   - Ensure adapters flush resources (streams, temp dirs) when interrupted.
