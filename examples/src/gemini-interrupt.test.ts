import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import { createCoder } from '@headless-coder-sdk/core/factory';
import type { CoderStreamEvent } from '@headless-coder-sdk/core';
import { CODER_NAME as GEMINI_CODER } from '@headless-coder-sdk/gemini-adapter';
import { ensureAdaptersRegistered } from './register-adapters';

const WORKSPACE = process.env.GEMINI_INTERRUPT_WORKSPACE ?? '/tmp/headless-coder-sdk/test_gemini_interrupt';
const CONNECT_FOUR_PROMPT =
  'Create an HTML/CSS/JS Connect Four game that highlights the winning line when a player wins.';

ensureAdaptersRegistered();

/**
 * Ensures Gemini CLI emits cancellation metadata when interrupted mid-stream.
 */
test('gemini run can be interrupted', async () => {
  await rm(WORKSPACE, { recursive: true, force: true });
  await mkdir(WORKSPACE, { recursive: true });

  const coder = createCoder(GEMINI_CODER, {
    workingDirectory: WORKSPACE,
    includeDirectories: [WORKSPACE],
    yolo: true,
  });
  const thread = await coder.startThread();
  const controller = new AbortController();
  const cancelTimer = setTimeout(() => {
    controller.abort('user cancel');
    void thread.interrupt?.('user cancel');
  }, 5000);
  const timeoutTimer = setTimeout(() => {
    controller.abort('interrupt timeout');
    void thread.interrupt?.('interrupt timeout');
  }, 15000);

  const events: CoderStreamEvent[] = [];
  try {
    for await (const event of thread.runStreamed(CONNECT_FOUR_PROMPT, {
      signal: controller.signal,
    })) {
      events.push(event);
      if (event.type === 'cancelled') break;
      if (event.type === 'error' && event.code === 'interrupted') break;
    }
  } catch (error) {
    if (!(error instanceof Error) || (error as any).code !== 'interrupted') {
      throw error;
    }
  } finally {
    clearTimeout(cancelTimer);
    clearTimeout(timeoutTimer);
    await coder.close?.(thread);
  }

  const sawCancelled = events.some(event => event.type === 'cancelled');
  const sawInterruptedError = events.some(event => event.type === 'error' && event.code === 'interrupted');
  assert.ok(sawCancelled || sawInterruptedError, 'expected gemini to emit cancellation metadata');
});
