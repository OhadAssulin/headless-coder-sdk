/**
 * @fileoverview Codex adapter that conforms to the HeadlessCoder interface with
 * explicit cancellation support via worker processes.
 */

import { fork, ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { now } from '@headless-coder-sdk/core';
import type {
  AdapterFactory,
  HeadlessCoder,
  ThreadHandle,
  PromptInput,
  StartOpts,
  RunOpts,
  RunResult,
  CoderStreamEvent,
  EventIterator,
  Provider,
} from '@headless-coder-sdk/core';

const WORKER_PATH = fileURLToPath(new URL('./worker.js', import.meta.url));
const SOFT_KILL_DELAY_MS = 250;
const HARD_KILL_DELAY_MS = 1500;
const DONE = Symbol('stream-done');
const STDERR_BUFFER_LIMIT = 64 * 1024;

export const CODER_NAME: Provider = 'codex';
export function createAdapter(defaults?: StartOpts): HeadlessCoder {
  return new CodexAdapter(defaults);
}
(createAdapter as AdapterFactory).coderName = CODER_NAME;

interface CodexThreadOptions {
  model?: string;
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
  workingDirectory?: string;
  skipGitRepoCheck?: boolean;
}

interface CodexThreadState {
  id?: string;
  options: CodexThreadOptions;
  codexExecutablePath?: string;
  currentRun?: ActiveRun | null;
}

interface WorkerRequest {
  input: string;
  outputSchema?: object;
  thread: {
    id?: string;
    options: CodexThreadOptions;
  };
  settings: {
    codexExecutablePath?: string;
  };
}

interface WorkerRunPayload {
  threadId?: string;
  result: {
    items: any[];
    finalResponse: string;
    structured?: unknown;
    usage?: any;
  };
}

interface SerializedError {
  message: string;
  stack?: string;
  name?: string;
  code?: string;
  stderr?: string;
}

type WorkerMessage =
  | { type: 'runResult'; payload: WorkerRunPayload }
  | { type: 'streamEvent'; payload: any }
  | { type: 'streamDone'; threadId?: string }
  | { type: 'cancelled'; reason?: string }
  | { type: 'aborted'; reason?: string }
  | { type: 'error'; error: SerializedError };

interface ActiveRun {
  child: ChildProcess;
  abortController: AbortController;
  stopExternal: () => void;
  aborted: boolean;
  softKillTimer?: NodeJS.Timeout;
  hardKillTimer?: NodeJS.Timeout;
  abortReason?: string;
}

export class CodexAdapter implements HeadlessCoder {
  constructor(private readonly defaultOpts?: StartOpts) {}

  async startThread(opts?: StartOpts): Promise<ThreadHandle> {
    const merged = this.mergeStartOpts(opts);
    const state: CodexThreadState = {
      options: this.extractThreadOptions(merged),
      codexExecutablePath: merged.codexExecutablePath,
    };
    return this.createThreadHandle(state);
  }

  async resumeThread(threadId: string, opts?: StartOpts): Promise<ThreadHandle> {
    const merged = this.mergeStartOpts(opts);
    const state: CodexThreadState = {
      id: threadId,
      options: this.extractThreadOptions(merged),
      codexExecutablePath: merged.codexExecutablePath,
    };
    return this.createThreadHandle(state);
  }

  private async runInternal(handle: ThreadHandle, input: PromptInput, opts?: RunOpts): Promise<RunResult> {
    const state = handle.internal as CodexThreadState;
    this.assertIdle(state);
    const normalizedInput = normalizeInput(input);
    const { promise, cleanup } = this.launchRunWorker(state, normalizedInput, opts);
    try {
      const payload = await promise;
      if (payload.threadId) {
        state.id = payload.threadId;
        handle.id = payload.threadId;
      }
      return this.mapRunResult(payload);
    } finally {
      cleanup();
    }
  }

  private runStreamedInternal(handle: ThreadHandle, input: PromptInput, opts?: RunOpts): EventIterator {
    const state = handle.internal as CodexThreadState;
    this.assertIdle(state);
    const normalizedInput = normalizeInput(input);
    return this.buildStreamIterator(state, handle, normalizedInput, opts);
  }

  getThreadId(thread: ThreadHandle): string | undefined {
    const state = thread.internal as CodexThreadState;
    return state.id;
  }

  private createThreadHandle(state: CodexThreadState): ThreadHandle {
    const handle: ThreadHandle = {
      provider: CODER_NAME,
      internal: state,
      id: state.id,
      run: (input, opts) => this.runInternal(handle, input, opts),
      runStreamed: (input, opts) => this.runStreamedInternal(handle, input, opts),
      interrupt: async reason => {
        this.abortCurrentRun(state, reason ?? 'Interrupted');
      },
    };
    return handle;
  }

  private mergeStartOpts(opts?: StartOpts): StartOpts {
    return { ...this.defaultOpts, ...opts };
  }

  private extractThreadOptions(opts: StartOpts): CodexThreadOptions {
    return {
      model: opts.model,
      sandboxMode: opts.sandboxMode,
      workingDirectory: opts.workingDirectory,
      skipGitRepoCheck: opts.skipGitRepoCheck,
    };
  }

  private launchRunWorker(state: CodexThreadState, input: string, opts?: RunOpts) {
    const child = fork(WORKER_PATH, { stdio: ['inherit', 'inherit', 'pipe', 'ipc'] });
    const stderr = collectChildStderr(child);
    const abortController = new AbortController();
    const stopExternal = linkSignal(opts?.signal, reason => {
      if (!abortController.signal.aborted) {
        abortController.abort(reason ?? 'Interrupted');
        this.abortChild(state, reason);
      }
    });
    const active: ActiveRun = {
      child,
      abortController,
      stopExternal,
      aborted: false,
    };
    state.currentRun = active;

    const request: WorkerRequest = {
      input,
      outputSchema: opts?.outputSchema,
      thread: {
        id: state.id,
        options: state.options,
      },
      settings: {
        codexExecutablePath: state.codexExecutablePath,
      },
    };

    const promise = new Promise<WorkerRunPayload>((resolve, reject) => {
      let settled = false;
      const detach = () => {
        if (settled) return;
        settled = true;
        child.removeAllListeners();
      };

      child.on('message', (raw: WorkerMessage) => {
        if (settled) return;
        switch (raw.type) {
          case 'runResult':
            detach();
            resolve(raw.payload);
            break;
          case 'aborted':
            detach();
            reject(attachStderr(createAbortError(raw.reason), stderr.read()));
            break;
          case 'error':
            detach();
            reject(attachStderr(deserializeError(raw.error), stderr.read()));
            break;
        }
      });

      child.once('exit', (code, signal) => {
        if (settled) return;
        detach();
        const stderrOutput = stderr.read();
        if (active.aborted || signal) {
          const reason = active.abortReason ?? (signal ? `Worker exited via signal ${signal}` : undefined);
          reject(attachStderr(createAbortError(reason), stderrOutput));
        } else if (code === 0) {
          reject(createWorkerExitError('Codex worker exited before returning a result.', stderrOutput));
        } else {
          reject(createWorkerExitError(`Codex worker exited with code ${code}`, stderrOutput));
        }
      });

      child.once('error', error => {
        if (settled) return;
        detach();
        reject(attachStderr(error as Error, stderr.read()));
      });

      child.send({ type: 'run', payload: request });
    });

    const cleanup = () => {
      if (state.currentRun === active) {
        state.currentRun = null;
      }
      this.clearKillTimers(active);
      active.stopExternal();
      stderr.cleanup();
      try {
        child.removeAllListeners();
      } catch {
        // ignore
      }
      if (!child.killed && child.exitCode === null) {
        child.kill('SIGTERM');
      }
    };

    return { promise, cleanup };
  }

  private buildStreamIterator(
    state: CodexThreadState,
    handle: ThreadHandle,
    input: string,
    opts?: RunOpts,
  ): EventIterator {
    const child = fork(WORKER_PATH, { stdio: ['inherit', 'inherit', 'pipe', 'ipc'] });
    const stderr = collectChildStderr(child);
    const abortController = new AbortController();
    const stopExternal = linkSignal(opts?.signal, reason => {
      if (!abortController.signal.aborted) {
        abortController.abort(reason ?? 'Interrupted');
        this.abortChild(state, reason);
      }
    });
    const active: ActiveRun = {
      child,
      abortController,
      stopExternal,
      aborted: false,
    };
    state.currentRun = active;

    const request: WorkerRequest = {
      input,
      outputSchema: opts?.outputSchema,
      thread: {
        id: state.id,
        options: state.options,
      },
      settings: {
        codexExecutablePath: state.codexExecutablePath,
      },
    };

    const queue: Array<CoderStreamEvent | typeof DONE | Error> = [];
    const resolvers: Array<(value: CoderStreamEvent | typeof DONE | Error) => void> = [];
    let finished = false;

    const push = (entry: CoderStreamEvent | typeof DONE | Error) => {
      if (resolvers.length) {
        const resolve = resolvers.shift()!;
        resolve(entry);
      } else {
        queue.push(entry);
      }
    };

    const next = (): Promise<CoderStreamEvent | typeof DONE | Error> => {
      if (queue.length) {
        return Promise.resolve(queue.shift()!);
      }
      if (finished) {
        return Promise.resolve(DONE);
      }
      return new Promise(resolve => {
        resolvers.push(resolve);
      });
    };

    child.on('message', (raw: WorkerMessage) => {
      switch (raw.type) {
        case 'streamEvent': {
          for (const event of normalizeCodexEvent(raw.payload)) {
            push(event);
          }
          break;
        }
        case 'streamDone': {
          if (raw.threadId) {
            state.id = raw.threadId;
            handle.id = raw.threadId;
          }
          finished = true;
          push(DONE);
          break;
        }
        case 'cancelled': {
          const reason = raw.reason ?? 'Interrupted';
          push(createCancelledEvent(reason));
          push(createInterruptedErrorEvent(reason));
          finished = true;
          push(DONE);
          break;
        }
        case 'aborted': {
          push(attachStderr(createAbortError(raw.reason), stderr.read()));
          finished = true;
          push(DONE);
          break;
        }
        case 'error': {
          push(attachStderr(deserializeError(raw.error), stderr.read()));
          finished = true;
          push(DONE);
          break;
        }
      }
    });

    child.once('exit', (code, signal) => {
      if (finished) return;
      finished = true;
      const stderrOutput = stderr.read();
      if (active.aborted) {
        const reason = active.abortReason ?? 'Interrupted';
        push(createCancelledEvent(reason, stderrOutput));
        push(createInterruptedErrorEvent(reason));
        push(DONE);
        return;
      }
      if (signal) {
        const reason = `Codex worker exited via signal ${signal}`;
        push(createCancelledEvent(reason, stderrOutput));
        push(createWorkerExitErrorEvent(reason, stderrOutput));
        push(DONE);
        return;
      }
      if (code === 0) {
        const reason = 'Codex worker exited before completing the stream.';
        push(createCancelledEvent(reason, stderrOutput));
        push(createWorkerExitErrorEvent(reason, stderrOutput));
        push(DONE);
        return;
      }
      push(createWorkerExitError(`Codex worker exited with code ${code}`, stderrOutput));
      push(DONE);
    });

    child.once('error', error => {
      if (finished) return;
      finished = true;
      push(attachStderr(error as Error, stderr.read()));
      push(DONE);
    });

    child.send({ type: 'stream', payload: request });

    const adapter = this;
    const iterator = {
      [Symbol.asyncIterator]: async function* () {
        let threw = false;
        try {
          while (true) {
            const entry = await next();
            if (entry === DONE) break;
            if (entry instanceof Error) throw entry;
            yield entry;
          }
        } catch (error) {
          threw = true;
          throw error;
        } finally {
          stopExternal();
          if (!finished && !active.aborted && !threw) {
            adapter.abortChild(state, 'Stream closed');
          }
          adapter.clearKillTimers(active);
          if (state.currentRun === active) {
            state.currentRun = null;
          }
          stderr.cleanup();
          if (!child.killed && child.exitCode === null) {
            child.kill('SIGTERM');
          }
        }
      },
    };

    return iterator;
  }

  private abortCurrentRun(state: CodexThreadState, reason?: string): void {
    const active = state.currentRun;
    if (!active) return;
    if (!active.abortController.signal.aborted) {
      active.abortController.abort(reason ?? 'Interrupted');
    }
    this.abortChild(state, reason);
  }

  private abortChild(state: CodexThreadState, reason?: string): void {
    const active = state.currentRun;
    if (!active || active.aborted) return;
    active.aborted = true;
    active.abortReason = reason ?? 'Interrupted';
    try {
      active.child.send?.({ type: 'abort', reason: active.abortReason });
    } catch {
      // ignore
    }
    if (!active.softKillTimer) {
      active.softKillTimer = setTimeout(() => {
        if (!active.child.killed) {
          active.child.kill('SIGTERM');
        }
      }, SOFT_KILL_DELAY_MS);
    }
    if (!active.hardKillTimer) {
      active.hardKillTimer = setTimeout(() => {
        if (!active.child.killed) {
          active.child.kill('SIGKILL');
        }
      }, HARD_KILL_DELAY_MS);
    }
  }

  private clearKillTimers(active: ActiveRun): void {
    if (active.softKillTimer) {
      clearTimeout(active.softKillTimer);
      active.softKillTimer = undefined;
    }
    if (active.hardKillTimer) {
      clearTimeout(active.hardKillTimer);
      active.hardKillTimer = undefined;
    }
  }

  private mapRunResult(payload: WorkerRunPayload): RunResult {
    const finalResponse = payload.result.finalResponse ?? '';
    const structured =
      payload.result.structured === undefined ? extractJsonPayload(finalResponse) : payload.result.structured;
    return {
      threadId: payload.threadId,
      text: finalResponse || undefined,
      json: structured,
      usage: payload.result.usage,
      raw: payload.result,
    };
  }

  private assertIdle(state: CodexThreadState): void {
    if (state.currentRun) {
      throw new Error('Codex adapter only supports one in-flight run per thread.');
    }
  }
}

function normalizeInput(input: PromptInput): string {
  if (typeof input === 'string') return input;
  return input.map(message => `${message.role.toUpperCase()}: ${message.content}`).join('\n');
}

function extractJsonPayload(text: string | undefined): unknown | undefined {
  if (!text) return undefined;
  const fenced = text.match(/```json\s*([\s\S]+?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return undefined;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

function normalizeCodexEvent(event: any): CoderStreamEvent[] {
  const ts = now();
  const provider: Provider = CODER_NAME;
  const ev = event ?? {};
  const type = ev?.type;
  const normalized: CoderStreamEvent[] = [];

  if (type === 'thread.started') {
    normalized.push({ type: 'init', provider, threadId: ev.thread_id, ts, originalItem: ev });
    return normalized;
  }

  if (type === 'turn.started') {
    normalized.push({ type: 'progress', provider, label: 'turn.started', ts, originalItem: ev });
    return normalized;
  }

  if (typeof type === 'string' && type.startsWith('permission.')) {
    const decision = type.endsWith('granted') ? 'granted' : type.endsWith('denied') ? 'denied' : undefined;
    normalized.push({
      type: 'permission',
      provider,
      request: ev.permission ?? ev.request,
      decision,
      ts,
      originalItem: ev,
    });
    return normalized;
  }

  if (type === 'item.delta') {
    const item = ev.item ?? {};
    if (item.type === 'agent_message') {
      normalized.push({
        type: 'message',
        provider,
        role: 'assistant',
        text: ev.delta ?? item.text,
        delta: true,
        ts,
        originalItem: ev,
      });
      return normalized;
    }

    normalized.push({
      type: 'progress',
      provider,
      label: `item.delta:${item.type ?? 'event'}`,
      detail: typeof ev.delta === 'string' ? ev.delta : undefined,
      ts,
      originalItem: ev,
    });
    return normalized;
  }

  if (type === 'item.completed') {
    const item = ev.item ?? {};
    if (item.type === 'agent_message') {
      normalized.push({
        type: 'message',
        provider,
        role: 'assistant',
        text: item.text,
        ts,
        originalItem: ev,
      });
      return normalized;
    }

    normalized.push({
      type: 'progress',
      provider,
      label: `item.completed:${item.type ?? 'event'}`,
      ts,
      originalItem: ev,
    });
    return normalized;
  }

  if (type === 'tool_use') {
    normalized.push({
      type: 'tool_use',
      provider,
      name: ev.item?.name ?? 'tool',
      callId: ev.item?.id,
      args: ev.item?.input,
      ts,
      originalItem: ev,
    });
    return normalized;
  }

  if (type === 'tool_result') {
    normalized.push({
      type: 'tool_result',
      provider,
      name: ev.item?.name ?? 'tool',
      callId: ev.item?.id,
      result: ev.item?.output,
      exitCode: ev.item?.exit_code ?? null,
      ts,
      originalItem: ev,
    });
    return normalized;
  }

  if (type === 'turn.completed') {
    normalized.push({
      type: 'usage',
      provider,
      stats: ev.usage,
      ts,
      originalItem: ev,
    });
    normalized.push({ type: 'done', provider, ts, originalItem: ev });
    return normalized;
  }

  if (type === 'turn.failed') {
    normalized.push({
      type: 'error',
      provider,
      code: 'turn.failed',
      message: ev.error?.message ?? 'Codex turn failed',
      ts,
      originalItem: ev,
    });
    return normalized;
  }

  normalized.push({
    type: 'progress',
    provider,
    label: type ?? 'codex.event',
    ts,
    originalItem: ev,
  });
  return normalized;
}

function linkSignal(signal: AbortSignal | undefined, onAbort: (reason?: string) => void): () => void {
  if (!signal) return () => {};
  const handler = () => onAbort(reasonToString(signal.reason));
  signal.addEventListener('abort', handler, { once: true });
  return () => signal.removeEventListener('abort', handler);
}

function createAbortError(reason?: string): Error {
  const error = new Error(reason ?? 'Operation was interrupted');
  error.name = 'AbortError';
  (error as any).code = 'interrupted';
  return error;
}

function deserializeError(serialized: SerializedError): Error {
  const error = new Error(serialized.message);
  if (serialized.stack) error.stack = serialized.stack;
  if (serialized.name) error.name = serialized.name;
  if (serialized.code) (error as any).code = serialized.code;
  if (serialized.stderr) (error as any).stderr = serialized.stderr;
  return error;
}

function createInterruptedErrorEvent(reason?: string): CoderStreamEvent {
  return {
    type: 'error',
    provider: CODER_NAME,
    code: 'interrupted',
    message: reason ?? 'Operation was interrupted',
    ts: now(),
    originalItem: { reason },
  };
}

function reasonToString(reason: unknown): string | undefined {
  if (typeof reason === 'string') return reason;
  if (reason instanceof Error && reason.message) return reason.message;
  return undefined;
}

function collectChildStderr(child: ChildProcess, limit = STDERR_BUFFER_LIMIT): {
  read(): string;
  cleanup(): void;
} {
  const chunks: Buffer[] = [];
  let size = 0;
  const onData = (chunk: Buffer | string) => {
    if (size >= limit) return;
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const remaining = limit - size;
    if (buffer.length <= remaining) {
      chunks.push(buffer);
      size += buffer.length;
    } else {
      chunks.push(buffer.subarray(0, remaining));
      size = limit;
    }
  };
  child.stderr?.on('data', onData);
  return {
    read(): string {
      if (!chunks.length) return '';
      return Buffer.concat(chunks).toString('utf8').trim();
    },
    cleanup(): void {
      if (!child.stderr) return;
      child.stderr.removeListener('data', onData);
    },
  };
}

function attachStderr<T extends Error>(error: T, stderr: string | undefined): T {
  if (stderr && !(error as any).stderr) {
    (error as any).stderr = stderr;
  }
  return error;
}

function createWorkerExitError(message: string, stderr?: string): Error {
  const formatted = formatWorkerExitMessage(message, stderr);
  const error = new Error(formatted);
  if (stderr) (error as any).stderr = stderr;
  return error;
}

function createWorkerExitErrorEvent(message: string, stderr?: string): CoderStreamEvent {
  const original: { reason: string; stderr?: string } = { reason: message };
  if (stderr) original.stderr = stderr;
  return {
    type: 'error',
    provider: CODER_NAME,
    code: 'codex.worker_exit',
    message,
    ts: now(),
    originalItem: original,
  };
}

function createCancelledEvent(reason: string, stderr?: string): CoderStreamEvent {
  const original: { reason: string; stderr?: string } = { reason };
  if (stderr) original.stderr = stderr;
  return {
    type: 'cancelled',
    provider: CODER_NAME,
    ts: now(),
    originalItem: original,
  };
}

function formatWorkerExitMessage(base: string, stderr?: string): string {
  if (!stderr) return base;
  const trimmed = stderr.trim();
  if (!trimmed) return base;
  return `${base}: ${trimmed}`;
}
