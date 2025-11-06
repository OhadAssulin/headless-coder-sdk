/**
 * @fileoverview Gemini CLI adapter integrating with the HeadlessCoder contract.
 */

import { spawn } from 'node:child_process';
import * as readline from 'node:readline';
import type {
  HeadlessCoder,
  ThreadHandle,
  PromptInput,
  StartOpts,
  RunOpts,
  RunResult,
  StreamEvent,
} from '@headless-coders/core';

/**
 * Resolves the Gemini binary path, honoring user overrides.
 *
 * Args:
 *   override: Optional executable override.
 *
 * Returns:
 *   Binary path to invoke.
 */
function geminiPath(override?: string): string {
  return override || 'gemini';
}

/**
 * Normalises prompt input into a single string for CLI invocation.
 *
 * Args:
 *   input: Prompt payload.
 *
 * Returns:
 *   Prompt string understood by Gemini CLI.
 */
function toPrompt(input: PromptInput): string {
  if (typeof input === 'string') return input;
  return input.map(message => `${message.role}: ${message.content}`).join('\n');
}

/**
 * Adapter that proxies Gemini CLI headless invocations.
 *
 * Args:
 *   defaultOpts: Default options used whenever callers omit overrides.
 */
export class GeminiAdapter implements HeadlessCoder {
  /**
   * Creates a new Gemini adapter instance.
   *
   * Args:
   *   defaultOpts: Default options used whenever callers omit overrides.
   */
  constructor(private readonly defaultOpts?: StartOpts) {}

  /**
   * Creates a thread handle encapsulating Gemini options.
   *
   * Args:
   *   opts: Start options for the thread lifecycle.
   *
   * Returns:
   *   Thread handle stub (Gemini is stateless).
   */
  async startThread(opts?: StartOpts): Promise<ThreadHandle> {
    const options = { ...this.defaultOpts, ...opts };
    return { provider: 'gemini', internal: { opts: options } };
  }

  /**
   * Produces a thread handle for a previously known identifier.
   *
   * Args:
   *   threadId: Gemini session identifier (best-effort).
   *   opts: Options that should apply to future runs.
   *
   * Returns:
   *   Thread handle referencing Gemini state.
   */
  async resumeThread(threadId: string, opts?: StartOpts): Promise<ThreadHandle> {
    const options = { ...this.defaultOpts, ...opts };
    return { provider: 'gemini', id: threadId, internal: { opts: options } };
  }

  /**
   * Runs Gemini CLI and returns the parsed JSON response when available.
   *
   * Args:
   *   thread: Thread handle.
   *   input: Prompt payload.
   *   opts: Run-level configuration such as additional env vars.
   *
   * Returns:
   *   Parsed run result.
   *
   * Raises:
   *   Error: When the Gemini CLI exits with a non-zero status.
   */
  async run(thread: ThreadHandle, input: PromptInput, opts?: RunOpts): Promise<RunResult> {
    const startOpts = ((thread.internal as any)?.opts ?? {}) as StartOpts;
    const args = ['--output-format', 'json', '--prompt', toPrompt(input)];
    if (startOpts.model) args.push('--model', startOpts.model);
    if (startOpts.includeDirectories?.length) {
      args.push('--include-directories', startOpts.includeDirectories.join(','));
    }
    if (startOpts.yolo) args.push('--yolo');

    const proc = spawn(geminiPath(startOpts.geminiBinaryPath), args, {
      cwd: startOpts.workingDirectory,
      env: { ...process.env, ...(opts?.extraEnv ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    const stderr: string[] = [];
    proc.stdout.on('data', chunk => {
      stdout += chunk.toString('utf8');
    });
    proc.stderr.on('data', chunk => {
      stderr.push(chunk.toString('utf8'));
    });

    const exitCode = await new Promise<number>(resolve => proc.on('close', resolve));
    if (exitCode !== 0) {
      throw new Error(`gemini exited with code ${exitCode}: ${stderr.join('')}`);
    }

    let parsed: any;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      parsed = { response: stdout };
    }

    return {
      threadId: parsed.session_id ?? thread.id,
      text: parsed.response ?? parsed.text ?? stdout,
      json: parsed.json,
      usage: parsed.stats,
      raw: parsed,
    };
  }

  /**
   * Streams Gemini CLI output and maps events into the shared shape.
   *
   * Args:
   *   thread: Thread handle used for contextual options.
   *   input: Prompt payload.
   *   opts: Run-level modifiers (e.g., environment variables).
   *
   * Returns:
   *   Async iterator over stream events.
   *
   * Raises:
   *   Error: When the Gemini CLI process fails before emitting events.
   */
  async *runStreamed(
    thread: ThreadHandle,
    input: PromptInput,
    opts?: RunOpts,
  ): AsyncIterable<StreamEvent> {
    const startOpts = ((thread.internal as any)?.opts ?? {}) as StartOpts;
    const args = ['--output-format', 'stream-json', '--prompt', toPrompt(input)];
    if (startOpts.model) args.push('--model', startOpts.model);
    if (startOpts.includeDirectories?.length) {
      args.push('--include-directories', startOpts.includeDirectories.join(','));
    }
    if (startOpts.yolo) args.push('--yolo');

    const proc = spawn(geminiPath(startOpts.geminiBinaryPath), args, {
      cwd: startOpts.workingDirectory,
      env: { ...process.env, ...(opts?.extraEnv ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const rl = readline.createInterface({ input: proc.stdout });
    for await (const line of rl) {
      let event: any;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }

      switch (event.type) {
        case 'init':
          thread.id = event.session_id ?? thread.id;
          yield { type: 'init', provider: 'gemini', threadId: thread.id, raw: event };
          break;
        case 'message':
          yield {
            type: 'message',
            role: event.role ?? 'assistant',
            text: event.content,
            delta: !!event.delta,
            raw: event,
          };
          break;
        case 'tool_use':
        case 'tool_result':
          yield {
            type: event.type,
            name: event.tool_name,
            payload: event,
            raw: event,
          };
          break;
        case 'error':
          yield { type: 'error', error: event.message ?? 'gemini error', raw: event };
          break;
        case 'result':
          yield { type: 'done', raw: event };
          break;
        default:
          yield { type: 'progress', raw: event };
          break;
      }
    }
  }

  /**
   * Returns last known Gemini session identifier.
   *
   * Args:
   *   thread: Thread handle.
   *
   * Returns:
   *   Session identifier if present.
   */
  getThreadId(thread: ThreadHandle): string | undefined {
    return thread.id;
  }
}
