import { Codex } from '@openai/codex-sdk';
import type { Thread } from '@openai/codex-sdk';

interface CodexThreadOptions {
  model?: string;
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
  workingDirectory?: string;
  skipGitRepoCheck?: boolean;
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

type WorkerInboundMessage =
  | { type: 'run'; payload: WorkerRequest }
  | { type: 'stream'; payload: WorkerRequest }
  | { type: 'abort'; reason?: string };

type WorkerOutboundMessage =
  | { type: 'runResult'; payload: WorkerRunResult }
  | { type: 'streamEvent'; payload: any }
  | { type: 'streamDone'; threadId?: string }
  | { type: 'cancelled'; reason?: string }
  | { type: 'aborted'; reason?: string }
  | { type: 'error'; error: SerializedError };

interface WorkerRunResult {
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

let abortRequested = false;
let abortReason: string | undefined;
let currentMode: 'run' | 'stream' | null = null;

process.on('message', async message => {
  const typed = message as WorkerInboundMessage;
  if (typed.type === 'abort') {
    abortRequested = true;
    abortReason = typed.reason;
    return;
  }
  abortRequested = false;
  abortReason = undefined;
  currentMode = typed.type;
  try {
    if (typed.type === 'run') {
      const payload = await executeRun(typed.payload);
      await emitAndWait({ type: 'runResult', payload });
      process.exit(0);
    } else if (typed.type === 'stream') {
      await executeStream(typed.payload);
      process.exit(0);
    }
  } catch (error) {
    await handleWorkerError(error);
  }
});

function emit(message: WorkerOutboundMessage): void {
  if (typeof process.send === 'function') {
    process.send(message);
  }
}

async function emitAndWait(message: WorkerOutboundMessage): Promise<void> {
  if (typeof process.send !== 'function') return;
  await new Promise<void>((resolve, reject) => {
    process.send!(message, err => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function createThread(payload: WorkerRequest) {
  const codex = new Codex(
    payload.settings.codexExecutablePath
      ? { codexPathOverride: payload.settings.codexExecutablePath }
      : undefined,
  );
  return payload.thread.id
    ? codex.resumeThread(payload.thread.id, payload.thread.options)
    : codex.startThread(payload.thread.options);
}

async function executeRun(payload: WorkerRequest): Promise<WorkerRunResult> {
  const thread = await createThread(payload);
  const summary = await consumeEvents(thread, payload, false);
  return { threadId: thread.id ?? undefined, result: summary };
}

async function executeStream(payload: WorkerRequest): Promise<void> {
  const thread = await createThread(payload);
  await consumeEvents(thread, payload, true);
  await emitAndWait({ type: 'streamDone', threadId: thread.id ?? undefined });
}

async function consumeEvents(thread: Thread, payload: WorkerRequest, emitEvents: boolean) {
  const run = await thread.runStreamed(payload.input, { outputSchema: payload.outputSchema });
  const items: any[] = [];
  let finalResponse = '';
  let usage: any = undefined;
  let structured: unknown = undefined;
  for await (const event of run.events) {
    if (abortRequested) {
      throw createAbortError(abortReason);
    }
    if (emitEvents) {
      emit({ type: 'streamEvent', payload: event });
    }
    if (event.type === 'item.completed') {
      items.push(event.item);
      if (event.item.type === 'agent_message' && typeof event.item.text === 'string') {
        finalResponse = event.item.text;
      }
      if (structured === undefined) {
        structured = extractStructuredFromItem(event.item);
      }
    } else if (event.type === 'turn.completed') {
      usage = event.usage;
      if (structured === undefined) {
        structured = extractStructuredFromTurn(event);
      }
    } else if (event.type === 'turn.failed') {
      const message = event.error?.message ?? 'Codex turn failed';
      const error = new Error(message);
      throw error;
    }
  }
  if (payload.outputSchema && structured === undefined) {
    structured = extractJsonPayload(finalResponse);
  }
  return { items, finalResponse, structured, usage };
}

async function handleWorkerError(error: unknown): Promise<void> {
  if (isAbortError(error)) {
    const reason = abortReason ?? (error as Error).message ?? 'Interrupted';
    if (currentMode === 'stream') {
      await emitAndWait({ type: 'cancelled', reason });
    } else {
      await emitAndWait({ type: 'aborted', reason });
    }
    process.exit(0);
    return;
  }
  await emitAndWait({ type: 'error', error: serializeError(error) });
  process.exit(1);
}

function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
      name: error.name,
      code: (error as any).code,
      stderr: (error as any).stderr,
    };
  }
  return { message: typeof error === 'string' ? error : 'Unknown error' };
}

function extractStructuredFromItem(item: any): unknown {
  if (!item) return undefined;
  return firstStructured([
    item.output_json,
    item.json,
    item.output,
    item.response_json,
    item.structured,
    item.data,
  ]);
}

function extractStructuredFromTurn(event: any): unknown {
  if (!event) return undefined;
  return firstStructured([event.output_json, event.json, event.result, event.output, event.response_json]);
}

function firstStructured(candidates: unknown[]): unknown {
  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object') {
      return candidate;
    }
  }
  return undefined;
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

function createAbortError(reason?: string): Error {
  const error = new Error(reason ?? 'Operation was interrupted');
  error.name = 'AbortError';
  (error as any).code = 'interrupted';
  return error;
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || (error as any).code === 'interrupted')
  );
}
