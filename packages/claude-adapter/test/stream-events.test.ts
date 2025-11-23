import assert from 'node:assert/strict';
import test from 'node:test';

import { CODER_NAME, __normalizeClaudeStreamMessage as normalize } from '../src/index.js';

const wrap = (event: Record<string, unknown>) => ({
  type: 'stream_event',
  session_id: 'sess-123',
  event,
});

test('content_block_delta text_delta emits assistant delta message', () => {
  const events = normalize(
    wrap({
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'Hello' },
    }),
    'sess-123',
  );

  assert.equal(events.length, 1);
  const [evt] = events;
  assert.equal(evt.type, 'message');
  assert.equal(evt.provider, CODER_NAME);
  assert.equal(evt.delta, true);
  assert.equal(evt.text, 'Hello');
});

test('content_block_start tool_use emits tool_use event', () => {
  const events = normalize(
    wrap({
      type: 'content_block_start',
      content_block: { type: 'tool_use', id: 'call-1', name: 'bash', input: { cmd: 'echo hi' } },
    }),
    'sess-123',
  );

  assert.equal(events.length, 1);
  const [evt] = events;
  assert.equal(evt.type, 'tool_use');
  assert.equal(evt.provider, CODER_NAME);
  assert.equal(evt.callId, 'call-1');
  assert.equal(evt.name, 'bash');
  assert.deepEqual(evt.args, { cmd: 'echo hi' });
});

test('message_delta usage is surfaced as usage event', () => {
  const usage = { input_tokens: 10, output_tokens: 5 };
  const events = normalize(
    wrap({
      type: 'message_delta',
      usage,
    }),
    'sess-123',
  );

  assert.equal(events.length, 1);
  const [evt] = events;
  assert.equal(evt.type, 'usage');
  assert.equal(evt.provider, CODER_NAME);
  assert.deepEqual(evt.stats, usage);
});

test('message_stop emits done', () => {
  const events = normalize(
    wrap({
      type: 'message_stop',
    }),
    'sess-123',
  );

  assert.equal(events.length, 1);
  const [evt] = events;
  assert.equal(evt.type, 'done');
  assert.equal(evt.provider, CODER_NAME);
});
