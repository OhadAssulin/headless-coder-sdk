import assert from 'node:assert/strict';
import test from 'node:test';

import { CODER_NAME, __normalizeCodexEvent as normalize } from '../src/index.js';

test('command_execution items emit tool use and tool result events', () => {
  const started = normalize({
    type: 'item.started',
    item: {
      id: 'cmd-1',
      type: 'command_execution',
      command: 'npm test',
      status: 'in_progress',
      aggregated_output: '',
    },
  });
  const completed = normalize({
    type: 'item.completed',
    item: {
      id: 'cmd-1',
      type: 'command_execution',
      command: 'npm test',
      status: 'completed',
      aggregated_output: 'ok',
      exit_code: 0,
    },
  });

  assert.equal(started.length, 1);
  assert.equal(started[0].type, 'tool_use');
  assert.equal(started[0].provider, CODER_NAME);
  assert.equal(started[0].name, 'command');
  assert.deepEqual(started[0].args, { command: 'npm test' });

  assert.equal(completed.length, 1);
  assert.equal(completed[0].type, 'tool_result');
  assert.equal(completed[0].provider, CODER_NAME);
  assert.equal(completed[0].result, 'ok');
  assert.equal(completed[0].exitCode, 0);
});

test('file_change items emit one file_change per changed path', () => {
  const events = normalize({
    type: 'item.completed',
    item: {
      id: 'patch-1',
      type: 'file_change',
      status: 'completed',
      changes: [
        { path: 'src/new.ts', kind: 'add' },
        { path: 'src/old.ts', kind: 'delete' },
      ],
    },
  });

  assert.equal(events.length, 2);
  assert.deepEqual(
    events.map(event => event.type),
    ['file_change', 'file_change'],
  );
  assert.equal(events[0].path, 'src/new.ts');
  assert.equal(events[0].op, 'create');
  assert.equal(events[1].path, 'src/old.ts');
  assert.equal(events[1].op, 'delete');
});

test('mcp_tool_call items emit tool use and result events', () => {
  const started = normalize({
    type: 'item.started',
    item: {
      id: 'mcp-1',
      type: 'mcp_tool_call',
      server: 'workspace',
      tool: 'read_file',
      arguments: { path: 'README.md' },
      status: 'in_progress',
    },
  });
  const completed = normalize({
    type: 'item.completed',
    item: {
      id: 'mcp-1',
      type: 'mcp_tool_call',
      server: 'workspace',
      tool: 'read_file',
      result: { content: [{ type: 'text', text: 'done' }] },
      status: 'completed',
    },
  });

  assert.equal(started[0].type, 'tool_use');
  assert.equal(started[0].name, 'workspace.read_file');
  assert.deepEqual(started[0].args, { path: 'README.md' });

  assert.equal(completed[0].type, 'tool_result');
  assert.equal(completed[0].name, 'workspace.read_file');
  assert.deepEqual(completed[0].result, { content: [{ type: 'text', text: 'done' }] });
});

test('todo lists, web searches, and stream errors are normalized', () => {
  const todo = normalize({
    type: 'item.updated',
    item: {
      id: 'todo-1',
      type: 'todo_list',
      items: [
        { text: 'Inspect SDK types', completed: true },
        { text: 'Run tests', completed: false },
      ],
    },
  });
  const search = normalize({
    type: 'item.started',
    item: { id: 'search-1', type: 'web_search', query: 'codex sdk release notes' },
  });
  const error = normalize({ type: 'error', message: 'boom' });

  assert.equal(todo[0].type, 'plan_update');
  assert.equal(todo[0].text, '[x] Inspect SDK types\n[ ] Run tests');
  assert.equal(search[0].type, 'progress');
  assert.equal(search[0].label, 'web_search');
  assert.equal(search[0].detail, 'codex sdk release notes');
  assert.equal(error[0].type, 'error');
  assert.equal(error[0].message, 'boom');
});
