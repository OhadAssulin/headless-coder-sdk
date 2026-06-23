import { test } from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';
import { createCoder } from '@headless-coder-sdk/core/factory';
import { CODER_NAME as CODEX_CODER_NAME } from '@headless-coder-sdk/codex-adapter';
import { ensureAdaptersRegistered } from './register-adapters';
import { codexLiveSkipReason } from './codex-test-utils';

ensureAdaptersRegistered();

test('codex resumes a conversation', async t => {
  const coder = createCoder(CODEX_CODER_NAME, {
    workingDirectory: process.cwd(),
    sandboxMode: 'workspace-write',
    skipGitRepoCheck: true,
  });

  const initialThread = await coder.startThread({ model: process.env.CODEX_MODEL ?? undefined });
  let firstRun;
  try {
    firstRun = await initialThread.run('List two tasks we should automate.');
  } catch (error) {
    const skipReason = codexLiveSkipReason(error);
    if (skipReason) {
      t.skip(skipReason);
      return;
    }
    throw error;
  }
  assert.ok(firstRun.text && firstRun.text.length > 0, 'First run should produce text.');

  const initialId = coder.getThreadId(initialThread) ?? firstRun.threadId;
  assert.ok(initialId, 'Codex should supply a thread id after the first run.');

  const resumedThread = await coder.resumeThread(initialId!);
  let followUp;
  try {
    followUp = await resumedThread.run('Continue with mitigation steps.');
  } catch (error) {
    const skipReason = codexLiveSkipReason(error);
    if (skipReason) {
      t.skip(skipReason);
      return;
    }
    throw error;
  }

  assert.equal(followUp.threadId, initialId);
  assert.ok(followUp.text && followUp.text.length > 0, 'Follow-up run should produce text.');
});
