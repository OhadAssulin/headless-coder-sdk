import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, cp, access, readFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { createCoder } from '@headless-coder-sdk/core/factory';
import type { CoderStreamEvent } from '@headless-coder-sdk/core';
import { CODER_NAME as CLAUDE_CODER } from '@headless-coder-sdk/claude-adapter';
import { ensureAdaptersRegistered } from './register-adapters';

const WORKSPACE = process.env.CLAUDE_INTERRUPT_WORKSPACE ?? '/tmp/headless-coder-sdk/test_claude_interrupt';
const CONNECT_FOUR_PROMPT =
  'Program a web-based Connect Four game that tracks the winner and allows restarting without refreshing the page.';
const CLAUDE_CONFIG_SOURCE = process.env.CLAUDE_INTERRUPT_SOURCE;

ensureAdaptersRegistered();

/**
 * Verifies Claude streams provide cancellation metadata when interrupted.
 */
test('claude run can be interrupted', async () => {
  if (!CLAUDE_CONFIG_SOURCE) {
    test.skip('CLAUDE_INTERRUPT_SOURCE env not set; skipping Claude interrupt test.');
    return;
  }

  await rm(WORKSPACE, { recursive: true, force: true });
  await mkdir(WORKSPACE, { recursive: true });
  await prepareClaudeWorkspace(WORKSPACE, CLAUDE_CONFIG_SOURCE);

  const coder = createCoder(CLAUDE_CODER, {
    workingDirectory: WORKSPACE,
    permissionMode: 'bypassPermissions',
    allowedTools: ['Write', 'Edit', 'Read', 'NotebookEdit'],
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
    for await (const event of thread.runStreamed(CONNECT_FOUR_PROMPT, { signal: controller.signal })) {
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
  assert.ok(sawCancelled || sawInterruptedError, 'expected Claude to emit cancellation metadata');
});

async function prepareClaudeWorkspace(workspace: string, sourceDir: string): Promise<void> {
  const configDir = path.join(workspace, '.claude');
  await rm(configDir, { recursive: true, force: true });
  await cp(sourceDir, configDir, { recursive: true });
  process.env.CLAUDE_CONFIG_DIR = configDir;
  await loadClaudeSettings(configDir);
}

async function loadClaudeSettings(configDir: string): Promise<void> {
  const files = ['settings.json', 'settings.local.json'];
  for (const file of files) {
    const fullPath = path.join(configDir, file);
    try {
      await access(fullPath, fsConstants.R_OK);
    } catch {
      continue;
    }
    const raw = await readFile(fullPath, 'utf8');
    if (!raw.trim()) continue;
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const envBlock = parsed?.env;
    if (envBlock && typeof envBlock === 'object') {
      for (const [key, value] of Object.entries(envBlock)) {
        if (typeof value === 'string') {
          process.env[key] = value;
        }
      }
    }
  }
}
