import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createHeadlessClaude } from '../src/index.js';

const CONFIG_SOURCE = process.env.CLAUDE_STREAM_CONFIG_SOURCE;

if (!CONFIG_SOURCE) {
  test.skip('claude streaming integration (requires CLAUDE_STREAM_CONFIG_SOURCE)', () => {});
} else {
  test(
    'claude streams partial messages and completes',
    { timeout: 120_000 },
    async () => {
      const workspace = '/tmp/headless-coder-sdk/test_claude_stream';
      const configDest = path.join(workspace, '.claude');
      fs.rmSync(configDest, { recursive: true, force: true });
      fs.cpSync(CONFIG_SOURCE, configDest, { recursive: true });
      assert(fs.existsSync(configDest), 'expected .claude directory in workspace');

      const coder = createHeadlessClaude({ permissionMode: 'bypassPermissions' });
      const thread = await coder.startThread({ workingDirectory: workspace });

      const events: any[] = [];
      for await (const evt of thread.runStreamed('Say hello briefly and mention your model.', { streamPartialMessages: true })) {
        events.push(evt);
        if (evt.type === 'done') break; // stop after completion
      }

      const messages = events.filter(e => e.type === 'message');
      assert(messages.length > 0, 'expected at least one assistant message');

      const combined = messages.map(m => m.text ?? '').join(' ');
      assert(
        !combined.toLowerCase().includes('credit balance is too low'),
        'Claude returned credit error; top up credits to run this test',
      );
      assert(
        /hello/i.test(combined),
        `expected assistant text to include "hello", got: "${combined || '[empty]'}"`,
      );

      const hasDelta = messages.some(m => m.delta === true);
      assert(hasDelta, 'expected at least one delta message from streaming');

      const usage = events.find(e => e.type === 'usage');
      assert(usage, 'expected a usage event');

      assert(events.some(e => e.type === 'done'), 'expected a done event');
    },
  );
}
