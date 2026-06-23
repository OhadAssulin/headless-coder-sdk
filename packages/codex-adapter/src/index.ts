/**
 * @fileoverview Codex adapter that conforms to the HeadlessCoder interface while
 * delegating directly to the Codex SDK with AbortSignal-based cancellation.
 */

import type { CodexOptions, Input, Thread, ThreadOptions, TurnOptions } from '@openai/codex-sdk';
import {
  now,
  registerAdapter,
  getAdapterFactory,
  createCoder,
} from '@headless-coder-sdk/core';
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
  PromptContentPart,
  PromptMessage,
} from '@headless-coder-sdk/core';

const isNodeRuntime = typeof process !== 'undefined' && !!process.versions?.node;

type CodexModule = typeof import('@openai/codex-sdk');
let codexModule: CodexModule | undefined;
let codexModulePromise: Promise<CodexModule> | undefined;

async function loadCodexModule(): Promise<CodexModule> {
  if (codexModule) return codexModule;
  if (!codexModulePromise) {
    codexModulePromise = import('@openai/codex-sdk').then(module => {
      codexModule = module;
      return module;
    });
  }
  return codexModulePromise;
}

function ensureNodeRuntime(action: string): void {
  if (!isNodeRuntime) {
    throw new Error(
      `@headless-coder-sdk/codex-adapter can only ${action} inside a Node.js runtime.`,
    );
  }
}

export const CODER_NAME: Provider = 'codex';
export const DEFAULT_MODEL = 'gpt-5.5';

export function createAdapter(defaults?: StartOpts): HeadlessCoder {
  return new CodexAdapter(defaults);
}
(createAdapter as AdapterFactory).coderName = CODER_NAME;

export function createHeadlessCodex(defaults?: StartOpts): HeadlessCoder {
  if (!getAdapterFactory(CODER_NAME)) {
    registerAdapter(createAdapter as AdapterFactory);
  }
  ensureNodeRuntime('create a Codex coder');
  return createCoder(CODER_NAME, defaults);
}

interface CodexThreadState {
  id?: string;
  options: ThreadOptions;
  clientOptions?: CodexOptions;
  currentRun?: ActiveRun | null;
}

interface CodexRunSummary {
  items: any[];
  finalResponse: string;
  structured?: unknown;
  usage?: any;
}

type RunTurnOptions = Pick<TurnOptions, 'outputSchema' | 'signal'>;

interface ActiveRun {
  abortController: AbortController;
  stopExternal: () => void;
  aborted: boolean;
  abortReason?: string;
}

export class CodexAdapter implements HeadlessCoder {
  constructor(private readonly defaultOpts?: StartOpts) {}

  async startThread(opts?: StartOpts): Promise<ThreadHandle> {
    const merged = this.mergeStartOpts(opts);
    const state: CodexThreadState = {
      options: this.extractThreadOptions(merged),
      clientOptions: this.extractClientOptions(merged),
    };
    return this.createThreadHandle(state);
  }

  async resumeThread(threadId: string, opts?: StartOpts): Promise<ThreadHandle> {
    const merged = this.mergeStartOpts(opts);
    const state: CodexThreadState = {
      id: threadId,
      options: this.extractThreadOptions(merged),
      clientOptions: this.extractClientOptions(merged),
    };
    return this.createThreadHandle(state);
  }

  private async runInternal(handle: ThreadHandle, input: PromptInput, opts?: RunOpts): Promise<RunResult> {
    ensureNodeRuntime('call Codex');
    const state = handle.internal as CodexThreadState;
    this.assertIdle(state);
    const normalizedInput = normalizeCodexInput(input);
    const abortController = new AbortController();
    const stopExternal = linkSignal(opts?.signal, reason => {
      this.abortCurrentRun(state, reason ?? 'Interrupted');
    });
    const active: ActiveRun = {
      abortController,
      stopExternal,
      aborted: false,
    };
    state.currentRun = active;

    try {
      const thread = await this.createThread(state);
      const summary = await collectRunSummary(thread, normalizedInput, {
        outputSchema: opts?.outputSchema,
        signal: abortController.signal,
      });
      const threadId = thread.id ?? undefined;
      if (threadId) {
        state.id = threadId;
        handle.id = threadId;
      }
      return this.mapRunResult(summary, threadId);
    } catch (error) {
      if (isAbortError(error)) {
        const reason =
          active.abortReason ??
          reasonToString(abortController.signal.reason) ??
          (error instanceof Error ? error.message : undefined);
        throw createAbortError(reason);
      }
      throw error;
    } finally {
      stopExternal();
      if (state.currentRun === active) {
        state.currentRun = null;
      }
    }
  }

  private runStreamedInternal(handle: ThreadHandle, input: PromptInput, opts?: RunOpts): EventIterator {
    ensureNodeRuntime('stream Codex events');
    const state = handle.internal as CodexThreadState;
    this.assertIdle(state);
    const normalizedInput = normalizeCodexInput(input);
    const abortController = new AbortController();
    const stopExternal = linkSignal(opts?.signal, reason => {
      this.abortCurrentRun(state, reason ?? 'Interrupted');
    });
    const active: ActiveRun = {
      abortController,
      stopExternal,
      aborted: false,
    };
    state.currentRun = active;

    const adapter = this;
    const iterator = {
      async *[Symbol.asyncIterator]() {
        let completed = false;
        let threw = false;
        try {
          const thread = await adapter.createThread(state);
          const run = await thread.runStreamed(normalizedInput, {
            outputSchema: opts?.outputSchema,
            signal: abortController.signal,
          });
          const threadId = thread.id ?? undefined;
          if (threadId) {
            state.id = threadId;
            handle.id = threadId;
          }
          for await (const event of run.events) {
            for (const normalized of normalizeCodexEvent(event)) {
              yield normalized;
            }
          }
          completed = true;
        } catch (error) {
          threw = true;
          if (isAbortError(error)) {
            const reason =
              active.abortReason ??
              reasonToString(abortController.signal.reason) ??
              (error instanceof Error ? error.message : undefined) ??
              'Interrupted';
            yield createCancelledEvent(reason);
            yield createInterruptedErrorEvent(reason);
            return;
          }
          throw error;
        } finally {
          if (!completed && !abortController.signal.aborted && !threw) {
            adapter.abortCurrentRun(state, 'Stream closed');
          }
          stopExternal();
          if (state.currentRun === active) {
            state.currentRun = null;
          }
        }
      },
    };

    return iterator;
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

  private extractThreadOptions(opts: StartOpts): ThreadOptions {
    const providerOptions = (opts.providerOptions?.codex ?? {}) as ThreadOptions;
    const options: ThreadOptions = { ...providerOptions };
    setIfDefined(options, 'model', opts.model ?? DEFAULT_MODEL);
    setIfDefined(options, 'sandboxMode', opts.sandboxMode);
    setIfDefined(options, 'workingDirectory', opts.workingDirectory);
    setIfDefined(options, 'skipGitRepoCheck', opts.skipGitRepoCheck);
    setIfDefined(options, 'modelReasoningEffort', opts.modelReasoningEffort);
    setIfDefined(options, 'networkAccessEnabled', opts.networkAccessEnabled);
    setIfDefined(options, 'webSearchMode', opts.webSearchMode);
    setIfDefined(options, 'webSearchEnabled', opts.webSearchEnabled);
    setIfDefined(options, 'approvalPolicy', opts.approvalPolicy);
    setIfDefined(options, 'additionalDirectories', opts.additionalDirectories);
    return options;
  }

  private extractClientOptions(opts: StartOpts): CodexOptions | undefined {
    const options: CodexOptions = {
      ...((opts.providerOptions?.codexClient ?? {}) as CodexOptions),
      ...((opts.codexClientOptions ?? {}) as CodexOptions),
    };
    setIfDefined(options, 'codexPathOverride', opts.codexExecutablePath);
    setIfDefined(options, 'baseUrl', opts.codexBaseUrl);
    setIfDefined(options, 'apiKey', opts.codexApiKey);
    setIfDefined(options, 'config', opts.codexConfig as CodexOptions['config']);
    setIfDefined(options, 'env', opts.codexEnv);
    return Object.keys(options).length ? options : undefined;
  }

  private async createThread(state: CodexThreadState): Promise<Thread> {
    const { Codex } = await loadCodexModule();
    const codex = new Codex(state.clientOptions);
    return state.id ? codex.resumeThread(state.id, state.options) : codex.startThread(state.options);
  }

  private mapRunResult(summary: CodexRunSummary, threadId?: string): RunResult {
    const finalResponse = summary.finalResponse ?? '';
    const structured =
      summary.structured === undefined ? extractJsonPayload(finalResponse) : summary.structured;
    return {
      threadId,
      text: finalResponse || undefined,
      json: structured,
      usage: summary.usage,
      raw: summary,
    };
  }

  private assertIdle(state: CodexThreadState): void {
    if (state.currentRun) {
      throw new Error('Codex adapter only supports one in-flight run per thread.');
    }
  }

  private abortCurrentRun(state: CodexThreadState, reason?: string): void {
    const active = state.currentRun;
    if (!active) return;
    if (!active.abortController.signal.aborted) {
      active.abortReason = reason ?? 'Interrupted';
      active.aborted = true;
      active.abortController.abort(active.abortReason);
    }
  }
}

function normalizeCodexInput(input: PromptInput): Input {
  if (typeof input === 'string') return input;
  if (isContentPartInput(input)) {
    return input.map(part => ({ ...part }));
  }
  return input.map(message => ({ type: 'text', text: `${message.role.toUpperCase()}: ${message.content}` }));
}

function isContentPartInput(input: PromptMessage[] | PromptContentPart[]): input is PromptContentPart[] {
  return input.every(part => part && typeof part === 'object' && 'type' in part);
}

function setIfDefined<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

async function collectRunSummary(
  thread: Thread,
  input: Input,
  options: RunTurnOptions,
): Promise<CodexRunSummary> {
  const run = await thread.runStreamed(input, options);
  const items: any[] = [];
  let finalResponse = '';
  let usage: any = undefined;
  let structured: unknown = undefined;

  for await (const event of run.events) {
    if (event.type === 'item.completed') {
      const item = event.item;
      items.push(item);
      if (item?.type === 'agent_message' && typeof item.text === 'string') {
        finalResponse = item.text;
      }
      if (structured === undefined) {
        structured = extractStructuredFromItem(item);
      }
    } else if (event.type === 'turn.completed') {
      usage = event.usage;
      if (structured === undefined) {
        structured = extractStructuredFromTurn(event);
      }
    } else if (event.type === 'turn.failed') {
      const message = event.error?.message ?? 'Codex turn failed';
      throw new Error(message);
    }
  }

  if (options.outputSchema && structured === undefined) {
    structured = extractJsonPayload(finalResponse);
  }

  return { items, finalResponse, structured, usage };
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

  if (type === 'error') {
    normalized.push({
      type: 'error',
      provider,
      message: ev.message ?? 'codex error',
      ts,
      originalItem: ev,
    });
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

  if (type === 'item.started' || type === 'item.updated' || type === 'item.completed') {
    return normalizeCodexItemEvent(ev, type, ts, provider);
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

function normalizeCodexItemEvent(
  ev: any,
  eventType: 'item.started' | 'item.updated' | 'item.completed',
  ts: number,
  provider: Provider,
): CoderStreamEvent[] {
  const item = ev.item ?? {};
  const itemType = item.type;
  const completed = eventType === 'item.completed';
  const updated = eventType === 'item.updated';

  if (itemType === 'agent_message') {
    return [
      {
        type: 'message',
        provider,
        role: 'assistant',
        text: item.text,
        delta: completed ? undefined : true,
        ts,
        originalItem: ev,
      },
    ];
  }

  if (itemType === 'reasoning') {
    return [
      {
        type: 'progress',
        provider,
        label: 'reasoning',
        detail: item.text,
        ts,
        originalItem: ev,
      },
    ];
  }

  if (itemType === 'command_execution') {
    if (completed) {
      return [
        {
          type: 'tool_result',
          provider,
          name: 'command',
          callId: item.id,
          result: item.aggregated_output ?? item.text,
          exitCode: item.exit_code ?? null,
          error: item.status === 'failed' ? item.aggregated_output ?? item.text : undefined,
          ts,
          originalItem: ev,
        },
      ];
    }
    if (updated) {
      return [
        {
          type: 'progress',
          provider,
          label: 'command_execution',
          detail: item.aggregated_output,
          ts,
          originalItem: ev,
        },
      ];
    }
    return [
      {
        type: 'tool_use',
        provider,
        name: 'command',
        callId: item.id,
        args: { command: item.command },
        ts,
        originalItem: ev,
      },
    ];
  }

  if (itemType === 'mcp_tool_call') {
    const name = [item.server, item.tool].filter(Boolean).join('.') || 'mcp_tool';
    if (completed) {
      return [
        {
          type: 'tool_result',
          provider,
          name,
          callId: item.id,
          result: item.result,
          error: item.error,
          ts,
          originalItem: ev,
        },
      ];
    }
    return [
      {
        type: 'tool_use',
        provider,
        name,
        callId: item.id,
        args: item.arguments,
        ts,
        originalItem: ev,
      },
    ];
  }

  if (itemType === 'file_change') {
    return normalizeCodexFileChange(ev, item, ts, provider);
  }

  if (itemType === 'todo_list') {
    return [
      {
        type: 'plan_update',
        provider,
        text: formatCodexTodoList(item.items),
        ts,
        originalItem: ev,
      },
    ];
  }

  if (itemType === 'web_search') {
    return [
      {
        type: 'progress',
        provider,
        label: 'web_search',
        detail: item.query,
        ts,
        originalItem: ev,
      },
    ];
  }

  if (itemType === 'error') {
    return [
      {
        type: 'error',
        provider,
        message: item.message ?? 'codex item error',
        ts,
        originalItem: ev,
      },
    ];
  }

  return [
    {
      type: 'progress',
      provider,
      label: itemType ?? eventType,
      detail: item.text ?? item.message,
      ts,
      originalItem: ev,
    },
  ];
}

function normalizeCodexFileChange(
  ev: any,
  item: any,
  ts: number,
  provider: Provider,
): CoderStreamEvent[] {
  const changes = Array.isArray(item.changes) ? item.changes : undefined;
  if (changes?.length) {
    return changes.map((change: { path?: string; kind?: string }) => ({
      type: 'file_change' as const,
      provider,
      path: change.path,
      op: mapCodexPatchKind(change.kind),
      patch: item.patch,
      ts,
      originalItem: ev,
    }));
  }
  return [
    {
      type: 'file_change',
      provider,
      path: item.path,
      op: item.op,
      patch: item.patch,
      ts,
      originalItem: ev,
    },
  ];
}

function mapCodexPatchKind(kind: string | undefined): 'create' | 'modify' | 'delete' | undefined {
  if (kind === 'add') return 'create';
  if (kind === 'update') return 'modify';
  if (kind === 'delete') return 'delete';
  return undefined;
}

function formatCodexTodoList(items: unknown): string | undefined {
  if (!Array.isArray(items)) return undefined;
  return items
    .map(item => {
      const text = typeof item?.text === 'string' ? item.text : '';
      if (!text) return '';
      return `${item.completed ? '[x]' : '[ ]'} ${text}`;
    })
    .filter(Boolean)
    .join('\n');
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

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || (error as any).code === 'interrupted')
  );
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

function createCancelledEvent(reason: string): CoderStreamEvent {
  return {
    type: 'cancelled',
    provider: CODER_NAME,
    ts: now(),
    originalItem: { reason },
  };
}

/**
 * @internal Exported for testing stream event normalization only.
 */
export const __normalizeCodexEvent = normalizeCodexEvent;
