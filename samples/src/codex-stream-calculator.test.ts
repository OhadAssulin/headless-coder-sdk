/**
 * @fileoverview Streams Codex output while producing a sin/cos calculator.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { JSDOM } from 'jsdom';
import { createCoder } from '@headless-coders/core/factory';
import type { PromptInput } from '@headless-coders/core/types';

const WORKSPACE = process.env.CODEX_STREAM_WORKSPACE ?? '/tmp/headless-coder/test_codex_stream';
const STREAM_FILE = 'stream.txt';

/**
 * Builds a prompt that instructs Codex to create a sin/cos calculator page.
 */
function buildPrompt(workspace: string): PromptInput {
  const instructions = [
    `You are working inside ${workspace}.`,
    'Tasks:',
    '- Overwrite index.html with a scientific calculator focused on sine and cosine.',
    '- Requirements:',
    '  * Provide inputs with ids angleDegrees and angleRadians plus buttons to compute sine and cosine.',
    '  * Display results in spans with ids sinResult and cosResult; descriptive prefixes like "sin:" are allowed.',
    '  * Implement window.toRadians(deg) and window.updateTrigValues() in inline JavaScript. They must parse numeric inputs, compute Math.sin and Math.cos, update the spans, and return the values.',
    '  * Attach event handlers so clicking the compute button prevents default submission and updates both sin and cos.',
    '  * Include inline CSS for clarity without external assets.',
    '- Do not create additional files or run shell commands beyond writing index.html.',
    '- After writing the file, confirm completion succinctly.',
  ].join('\n');

  return [
    { role: 'system', content: 'You produce deterministic project artifacts exactly as specified.' },
    { role: 'user', content: instructions },
  ];
}

test('codex streams a sin/cos calculator', async () => {
  await rm(path.join(WORKSPACE, 'index.html'), { force: true });
  await rm(path.join(WORKSPACE, STREAM_FILE), { force: true });
  await mkdir(WORKSPACE, { recursive: true });

  const coder = createCoder('codex', {
    workingDirectory: WORKSPACE,
    sandboxMode: 'workspace-write',
    skipGitRepoCheck: true,
  });

  const thread = await coder.startThread();
  const streamPath = path.join(WORKSPACE, STREAM_FILE);
  const stream = createWriteStream(streamPath, { flags: 'w' });

  try {
    for await (const event of coder.runStreamed(thread, buildPrompt(WORKSPACE))) {
      stream.write(`${JSON.stringify(event)}\n`);
    }
  } finally {
    await new Promise<void>(resolve => stream.end(resolve));
  }

  const htmlPath = path.join(WORKSPACE, 'index.html');
  const html = await readFile(htmlPath, 'utf8');
  assert.ok(html.includes('angleDegrees'), 'Generated HTML should contain the degrees input.');
  assert.ok(/Math\.sin|Math\.cos/.test(html), 'Generated HTML should reference Math.sin or Math.cos.');

  const dom = new JSDOM(html, { runScripts: 'dangerously' });
  const { window } = dom;

  assert.equal(typeof window.updateTrigValues, 'function', 'updateTrigValues must be defined.');

  const sinSpan = window.document.getElementById('sinResult');
  const cosSpan = window.document.getElementById('cosResult');
  const button =
    (window.document.getElementById('compute') as HTMLButtonElement | null) ||
    (window.document.getElementById('computeSin') as HTMLButtonElement | null) ||
    (window.document.querySelector('.compute-btn') as HTMLButtonElement | null) ||
    (window.document.querySelector('.compute-button') as HTMLButtonElement | null);
  const angleDegrees = window.document.getElementById('angleDegrees') as HTMLInputElement | null;

  assert.ok(sinSpan && cosSpan && button && angleDegrees, 'Calculator DOM elements must exist.');

  angleDegrees.value = '60';
  if (typeof window.updateTrigValues === 'function') {
    void window.updateTrigValues();
  }
  button.dispatchEvent(new window.Event('click'));

  const sinValue = sinSpan.textContent?.toLowerCase() ?? '';
  const cosValue = cosSpan.textContent?.toLowerCase() ?? '';
  assert.ok(sinValue.includes('0.866') || sinValue.includes('√3/2'.toLowerCase()), 'Sine result should update.');
  assert.ok(cosValue.includes('0.5') || cosValue.includes('1/2'), 'Cosine result should update.');

  const streamed = await readFile(streamPath, 'utf8');
  assert.ok(streamed.trim().length > 0, 'Stream output should be recorded.');
});
